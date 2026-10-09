package main

import (
	"context"
	"embed"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"
	"unicode/utf8"

	bolt "go.etcd.io/bbolt"
)

//go:embed all:web/dist
var assets embed.FS

var categories = []string{"医疗", "交通", "能源", "农业", "人工智能", "芯片", "航空航天", "其他"}

type Message struct {
	ID        uint64 `json:"id"`
	Content   string `json:"content"`
	Category  string `json:"category"`
	Nickname  string `json:"nickname"`
	Status    string `json:"status"`
	CreatedAt int64  `json:"createdAt"`
	ClientID  string `json:"clientId,omitempty"`
}
type Settings struct {
	RoomName   string `json:"roomName"`
	Paused     bool   `json:"paused"`
	Moderation bool   `json:"moderation"`
	Mode       string `json:"mode"`
	FinaleAt   int64  `json:"finaleAt"`
}
type Stats struct {
	Total        int            `json:"total"`
	Approved     int            `json:"approved"`
	Pending      int            `json:"pending"`
	Participants int            `json:"participants"`
	Categories   map[string]int `json:"categories"`
}
type Snapshot struct {
	Settings Settings  `json:"settings"`
	Messages []Message `json:"messages"`
	Stats    Stats     `json:"stats"`
	JoinURLs []string  `json:"joinURLs"`
}
type Event struct {
	Kind string `json:"kind"`
	Data any    `json:"data"`
}
type subscription struct {
	ch    chan Event
	admin bool
}
type limiter struct {
	start time.Time
	count int
}
type App struct {
	db       *bolt.DB
	mu       sync.Mutex // Serializes commits, snapshots and event subscription to avoid lost updates.
	settings Settings
	subs     map[*subscription]bool
	limits   map[string]limiter
	joinURLs []string
}

func idKey(id uint64) []byte { b := make([]byte, 8); binary.BigEndian.PutUint64(b, id); return b }
func newApp(file string) (*App, error) {
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		return nil, err
	}
	db, err := bolt.Open(file, 0600, &bolt.Options{Timeout: time.Second})
	if err != nil {
		return nil, err
	}
	a := &App{db: db, subs: map[*subscription]bool{}, limits: map[string]limiter{}}
	err = db.Update(func(tx *bolt.Tx) error {
		for _, name := range []string{"messages", "settings", "submissions"} {
			if _, e := tx.CreateBucketIfNotExists([]byte(name)); e != nil {
				return e
			}
		}
		b := tx.Bucket([]byte("settings"))
		raw := b.Get([]byte("current"))
		if raw != nil {
			return json.Unmarshal(raw, &a.settings)
		}
		a.settings = Settings{RoomName: "未来科技课堂", Mode: "live"}
		return saveSettings(tx, a.settings)
	})
	if err != nil {
		db.Close()
		return nil, err
	}
	return a, nil
}
func saveSettings(tx *bolt.Tx, s Settings) error {
	b, e := json.Marshal(s)
	if e != nil {
		return e
	}
	return tx.Bucket([]byte("settings")).Put([]byte("current"), b)
}
func publicMessage(m Message) Message { m.ClientID = ""; return m }
func (a *App) snapshotLocked(admin bool) (Snapshot, error) {
	s := Snapshot{Settings: a.settings, Messages: []Message{}, Stats: Stats{Categories: map[string]int{}}, JoinURLs: a.joinURLs}
	participants := map[string]bool{}
	err := a.db.View(func(tx *bolt.Tx) error {
		return tx.Bucket([]byte("messages")).ForEach(func(_, v []byte) error {
			var m Message
			if e := json.Unmarshal(v, &m); e != nil {
				return e
			}
			s.Stats.Total++
			if m.Status == "approved" {
				s.Stats.Approved++
				s.Stats.Categories[m.Category]++
				if m.ClientID != "" {
					participants[m.ClientID] = true
				}
				s.Messages = append(s.Messages, publicMessage(m))
			} else {
				s.Stats.Pending++
				if admin {
					s.Messages = append(s.Messages, publicMessage(m))
				}
			}
			return nil
		})
	})
	s.Stats.Participants = len(participants)
	if !admin {
		s.Stats.Total = s.Stats.Approved
		s.Stats.Pending = 0
		if len(s.Messages) > 240 {
			s.Messages = s.Messages[len(s.Messages)-240:]
		}
	}
	return s, err
}
func (a *App) broadcastLocked(kind string, data any, adminOnly bool) {
	for sub := range a.subs {
		if adminOnly && !sub.admin {
			continue
		}
		select {
		case sub.ch <- Event{kind, data}:
		default:
			close(sub.ch)
			delete(a.subs, sub)
		}
	}
}
func (a *App) notifyStatsLocked() {
	s, err := a.snapshotLocked(true)
	if err != nil {
		log.Print(err)
		return
	}
	public := s.Stats
	public.Total = public.Approved
	public.Pending = 0
	for sub := range a.subs {
		stats := public
		if sub.admin {
			stats = s.Stats
		}
		select {
		case sub.ch <- Event{"stats", stats}:
		default:
			close(sub.ch)
			delete(a.subs, sub)
		}
	}
}
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, msg string) {
	respond(w, status, map[string]string{"error": msg})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		fail(w, 400, "请求格式不正确")
		return false
	}
	if d.Decode(&struct{}{}) != io.EOF {
		fail(w, 400, "请求只能包含一份数据")
		return false
	}
	return true
}
func (a *App) allowedLocked(key string, max int, window time.Duration) bool {
	now := time.Now()
	l := a.limits[key]
	if now.Sub(l.start) > window {
		l = limiter{start: now}
	}
	l.count++
	a.limits[key] = l
	if len(a.limits) > 10000 {
		for k, v := range a.limits {
			if now.Sub(v.start) > time.Minute {
				delete(a.limits, k)
			}
		}
	}
	return l.count <= max
}
func clientIP(r *http.Request) string {
	ip, _, e := net.SplitHostPort(r.RemoteAddr)
	if e != nil {
		return r.RemoteAddr
	}
	return ip
}
func validText(s string, max int) bool {
	if utf8.RuneCountInString(s) < 1 || utf8.RuneCountInString(s) > max {
		return false
	}
	for _, c := range s {
		if unicode.IsControl(c) {
			return false
		}
	}
	return true
}

type Input struct {
	Content      string `json:"content"`
	Category     string `json:"category"`
	Nickname     string `json:"nickname"`
	ClientID     string `json:"clientId"`
	SubmissionID string `json:"submissionId"`
	Status       string `json:"status"`
}

func validateInput(in *Input) string {
	in.Content = strings.TrimSpace(in.Content)
	in.Nickname = strings.TrimSpace(in.Nickname)
	if !validText(in.Content, 80) {
		return "请填写 1～80 个字的想法，不要包含换行"
	}
	if in.Nickname == "" {
		in.Nickname = "匿名同学"
	}
	if !validText(in.Nickname, 20) {
		return "昵称最多 20 个字"
	}
	found := false
	for _, c := range categories {
		if in.Category == c {
			found = true
		}
	}
	if !found {
		return "请选择一个有效领域"
	}
	return ""
}
func (a *App) createMessage(w http.ResponseWriter, r *http.Request, admin bool) {
	var in Input
	if !decode(w, r, &in) {
		return
	}
	if e := validateInput(&in); e != "" {
		fail(w, 400, e)
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !admin {
		if !validText(in.ClientID, 80) || !validText(in.SubmissionID, 80) {
			fail(w, 400, "投稿标识无效，请刷新页面")
			return
		}
	}
	dedupKey := []byte(in.ClientID + ":" + in.SubmissionID)
	var previous Message
	var duplicate bool
	if !admin {
		err := a.db.View(func(tx *bolt.Tx) error {
			key := tx.Bucket([]byte("submissions")).Get(dedupKey)
			if key == nil {
				return nil
			}
			raw := tx.Bucket([]byte("messages")).Get(key)
			// A teacher may have deleted the message after the browser timed out.
			// Treat the stale idempotency pointer as unused so the student can retry.
			if raw == nil {
				return nil
			}
			duplicate = true
			return json.Unmarshal(raw, &previous)
		})
		if err != nil {
			fail(w, 500, "读取数据失败")
			return
		}
		if duplicate {
			respond(w, 200, map[string]any{"message": publicMessage(previous), "duplicate": true})
			return
		}
	}
	if !admin && a.settings.Paused {
		fail(w, 409, "老师已暂停投稿，请稍后再来")
		return
	}
	if !admin && (!a.allowedLocked("client:"+in.ClientID, 1, 2*time.Second) || !a.allowedLocked("ip:"+clientIP(r), 600, time.Minute)) {
		fail(w, 429, "想法正在飞向大屏，请稍等片刻再发送")
		return
	}
	status := "approved"
	if !admin && a.settings.Moderation {
		status = "pending"
	}
	if admin && in.Status == "pending" {
		status = "pending"
	}
	m := Message{Content: in.Content, Category: in.Category, Nickname: in.Nickname, Status: status, CreatedAt: time.Now().UnixMilli(), ClientID: in.ClientID}
	err := a.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("messages"))
		if b.Stats().KeyN >= 10000 {
			return errors.New("capacity")
		}
		id, e := b.NextSequence()
		if e != nil {
			return e
		}
		m.ID = id
		raw, e := json.Marshal(m)
		if e != nil {
			return e
		}
		if e = b.Put(idKey(id), raw); e != nil {
			return e
		}
		if !admin {
			return tx.Bucket([]byte("submissions")).Put(dedupKey, idKey(id))
		}
		return nil
	})
	if err != nil {
		if err.Error() == "capacity" {
			fail(w, 409, "课堂记录已满，请教师整理后再发送")
		} else {
			fail(w, 500, "保存失败，请重试")
		}
		return
	}
	a.broadcastLocked("message", publicMessage(m), m.Status != "approved")
	a.notifyStatsLocked()
	respond(w, 201, map[string]any{"message": publicMessage(m)})
}
func (a *App) updateMessage(w http.ResponseWriter, r *http.Request) {
	id, e := strconv.ParseUint(r.PathValue("id"), 10, 64)
	if e != nil {
		fail(w, 400, "弹幕编号无效")
		return
	}
	var in Input
	if r.Method == "PATCH" {
		if !decode(w, r, &in) {
			return
		}
		if e := validateInput(&in); e != "" {
			fail(w, 400, e)
			return
		}
		if in.Status != "pending" && in.Status != "approved" {
			fail(w, 400, "审核状态无效")
			return
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	var m Message
	oldStatus := ""
	err := a.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("messages"))
		raw := b.Get(idKey(id))
		if raw == nil {
			return os.ErrNotExist
		}
		if e := json.Unmarshal(raw, &m); e != nil {
			return e
		}
		oldStatus = m.Status
		if r.Method == "DELETE" {
			return b.Delete(idKey(id))
		}
		m.Content = in.Content
		m.Category = in.Category
		m.Nickname = in.Nickname
		m.Status = in.Status
		raw, e := json.Marshal(m)
		if e != nil {
			return e
		}
		return b.Put(idKey(id), raw)
	})
	if errors.Is(err, os.ErrNotExist) {
		fail(w, 404, "这条弹幕已不存在")
		return
	}
	if err != nil {
		fail(w, 500, "保存失败，请重试")
		return
	}
	if r.Method == "DELETE" {
		a.broadcastLocked("delete", map[string]uint64{"id": id}, oldStatus != "approved")
	} else {
		if oldStatus == "approved" && m.Status != "approved" {
			a.broadcastLocked("delete", map[string]uint64{"id": id}, false)
		}
		a.broadcastLocked("message", publicMessage(m), m.Status != "approved")
	}
	a.notifyStatsLocked()
	respond(w, 200, map[string]bool{"ok": true})
}
func (a *App) clearMessages(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	err := a.db.Update(func(tx *bolt.Tx) error {
		// Preserve the message sequence so in-flight browser events and old local
		// histories cannot confuse new comments with deleted ones after a reset.
		sequence := tx.Bucket([]byte("messages")).Sequence()
		for _, name := range []string{"messages", "submissions"} {
			if err := tx.DeleteBucket([]byte(name)); err != nil {
				return err
			}
			if _, err := tx.CreateBucket([]byte(name)); err != nil {
				return err
			}
		}
		return tx.Bucket([]byte("messages")).SetSequence(sequence)
	})
	if err != nil {
		fail(w, 500, "清空失败，请重试")
		return
	}
	// A new classroom can submit immediately, including from existing devices.
	a.limits = map[string]limiter{}
	a.broadcastLocked("clear", map[string]bool{"ok": true}, false)
	a.notifyStatsLocked()
	respond(w, 200, map[string]bool{"ok": true})
}
func (a *App) updateSettings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RoomName   *string `json:"roomName"`
		Paused     *bool   `json:"paused"`
		Moderation *bool   `json:"moderation"`
		Mode       *string `json:"mode"`
	}
	if !decode(w, r, &in) {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	next := a.settings
	if in.RoomName != nil {
		n := strings.TrimSpace(*in.RoomName)
		if !validText(n, 30) {
			fail(w, 400, "课堂名称应为 1～30 个字")
			return
		}
		next.RoomName = n
	}
	if in.Paused != nil {
		next.Paused = *in.Paused
	}
	if in.Moderation != nil {
		next.Moderation = *in.Moderation
	}
	if in.Mode != nil {
		if *in.Mode != "live" && *in.Mode != "finale" {
			fail(w, 400, "大屏模式无效")
			return
		}
		next.Mode = *in.Mode
		if next.Mode == "finale" {
			next.FinaleAt = time.Now().UnixMilli()
			next.Paused = true
		} else {
			next.FinaleAt = 0
			next.Paused = false
		}
	}
	if e := a.db.Update(func(tx *bolt.Tx) error { return saveSettings(tx, next) }); e != nil {
		fail(w, 500, "设置保存失败")
		return
	}
	a.settings = next
	a.broadcastLocked("settings", next, false)
	respond(w, 200, next)
}
func (a *App) events(w http.ResponseWriter, r *http.Request, admin bool) {
	f, ok := w.(http.Flusher)
	if !ok {
		fail(w, 500, "实时连接不可用")
		return
	}
	a.mu.Lock()
	if len(a.subs) >= 1000 {
		a.mu.Unlock()
		fail(w, 503, "实时连接已满，请稍后重试")
		return
	}
	s, err := a.snapshotLocked(admin)
	if err != nil {
		a.mu.Unlock()
		fail(w, 500, "读取课堂失败")
		return
	}
	sub := &subscription{make(chan Event, 32), admin}
	a.subs[sub] = true
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		if a.subs[sub] {
			delete(a.subs, sub)
			close(sub.ch)
		}
		a.mu.Unlock()
	}()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	write := func(e Event) bool {
		raw, err := json.Marshal(e.Data)
		if err != nil {
			return false
		}
		rc := http.NewResponseController(w)
		_ = rc.SetWriteDeadline(time.Now().Add(10 * time.Second))
		_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", e.Kind, raw)
		if err == nil {
			f.Flush()
		}
		return err == nil
	}
	if !write(Event{"snapshot", s}) {
		return
	}
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case e, ok := <-sub.ch:
			if !ok || !write(e) {
				return
			}
		case <-ticker.C:
			if !write(Event{"heartbeat", map[string]int64{"time": time.Now().UnixMilli()}}) {
				return
			}
		}
	}
}
func (a *App) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		a.mu.Lock()
		s, e := a.snapshotLocked(false)
		a.mu.Unlock()
		if e != nil {
			fail(w, 500, "读取课堂失败")
			return
		}
		respond(w, 200, s)
	})
	mux.HandleFunc("GET /api/events", func(w http.ResponseWriter, r *http.Request) { a.events(w, r, false) })
	mux.HandleFunc("POST /api/messages", func(w http.ResponseWriter, r *http.Request) { a.createMessage(w, r, false) })
	mux.HandleFunc("GET /api/admin/state", func(w http.ResponseWriter, r *http.Request) {
		a.mu.Lock()
		s, e := a.snapshotLocked(true)
		a.mu.Unlock()
		if e != nil {
			fail(w, 500, "读取课堂失败")
			return
		}
		respond(w, 200, s)
	})
	mux.HandleFunc("GET /api/admin/events", func(w http.ResponseWriter, r *http.Request) { a.events(w, r, true) })
	mux.HandleFunc("POST /api/admin/messages", func(w http.ResponseWriter, r *http.Request) { a.createMessage(w, r, true) })
	mux.HandleFunc("PATCH /api/admin/messages/{id}", a.updateMessage)
	mux.HandleFunc("DELETE /api/admin/messages/{id}", a.updateMessage)
	mux.HandleFunc("DELETE /api/admin/messages", a.clearMessages)
	mux.HandleFunc("PATCH /api/admin/settings", a.updateSettings)
	mux.HandleFunc("GET /api/admin/export", func(w http.ResponseWriter, r *http.Request) {
		a.mu.Lock()
		s, e := a.snapshotLocked(true)
		a.mu.Unlock()
		if e != nil {
			fail(w, 500, "导出失败")
			return
		}
		w.Header().Set("Content-Disposition", "attachment; filename=classroom-records.json")
		respond(w, 200, s)
	})
	web, _ := fs.Sub(assets, "web/dist")
	files := http.FileServer(http.FS(web))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			fail(w, 404, "接口不存在")
			return
		}
		if r.URL.Path == "/" || r.URL.Path == "/screen" || r.URL.Path == "/join" || r.URL.Path == "/teacher" {
			raw, e := fs.ReadFile(web, "index.html")
			if e != nil {
				http.Error(w, "请先运行 npm run build", 500)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write(raw)
			return
		}
		files.ServeHTTP(w, r)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != "GET" && r.Method != "HEAD" {
			if origin := r.Header.Get("Origin"); origin != "" {
				u, e := url.Parse(origin)
				if e != nil || u.Host != r.Host {
					fail(w, 403, "请从本课堂页面操作")
					return
				}
			}
		}
		mux.ServeHTTP(w, r)
	})
}
func localURLs(port string) []string {
	urls := []string{}
	addrs, _ := net.InterfaceAddrs()
	for _, addr := range addrs {
		ip, _, e := net.ParseCIDR(addr.String())
		if e == nil && ip.To4() != nil && ip.IsGlobalUnicast() {
			urls = append(urls, fmt.Sprintf("http://%s:%s/join", ip, port))
		}
	}
	return urls
}
func healthcheck(port string) error {
	client := &http.Client{Timeout: 3 * time.Second}
	res, err := client.Get("http://127.0.0.1:" + port + "/api/health")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("health status: %d", res.StatusCode)
	}
	var status struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(res.Body).Decode(&status); err != nil {
		return err
	}
	if status.Status != "ok" {
		return errors.New("unhealthy response")
	}
	return nil
}
func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "18080"
	}
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		if err := healthcheck(port); err != nil {
			log.Print(err)
			os.Exit(1)
		}
		return
	}
	file := os.Getenv("DATA_FILE")
	if file == "" {
		file = "data/classroom.db"
	}
	a, err := newApp(file)
	if err != nil {
		log.Fatal(err)
	}
	defer a.db.Close()
	a.joinURLs = localURLs(port)
	fmt.Printf("\n  中国芯 · 强国梦 课堂互动平台\n\n  大屏：http://localhost:%s/screen\n  教师：http://localhost:%s/teacher\n  学生：http://localhost:%s/join\n\n", port, port, port)
	for _, u := range a.joinURLs {
		fmt.Printf("  学生入口：%s\n", u)
	}
	srv := &http.Server{Addr: ":" + port, Handler: a.routes(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()
	if e := srv.ListenAndServe(); e != nil && !errors.Is(e, http.ErrServerClosed) {
		log.Fatal(e)
	}
}
