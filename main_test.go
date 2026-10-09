package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	bolt "go.etcd.io/bbolt"
)

func testApp(t *testing.T) (*App, *httptest.Server, *http.Client) {
	t.Helper()
	a, err := newApp(filepath.Join(t.TempDir(), "classroom.db"))
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewServer(a.routes())
	c := &http.Client{Timeout: 5 * time.Second}
	t.Cleanup(func() { s.Close(); a.db.Close() })
	return a, s, c
}
func request(t *testing.T, c *http.Client, method, url string, body any, want int) json.RawMessage {
	t.Helper()
	raw, _ := json.Marshal(body)
	r, err := http.NewRequest(method, url, bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set("Content-Type", "application/json")
	res, err := c.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var data json.RawMessage
	if err := json.NewDecoder(res.Body).Decode(&data); err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != want {
		t.Fatalf("%s %s: got %d, want %d: %s", method, url, res.StatusCode, want, data)
	}
	return data
}
func studentInput(id string) Input {
	return Input{Content: "高端医疗设备需要自主可控", Category: "医疗", Nickname: "同学", ClientID: id, SubmissionID: "first"}
}
func snapshot(t *testing.T, c *http.Client, url string) Snapshot {
	t.Helper()
	var s Snapshot
	if err := json.Unmarshal(request(t, c, "GET", url, nil, 200), &s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestModerationCRUDAndPrivacy(t *testing.T) {
	_, s, c := testApp(t)
	request(t, c, "PATCH", s.URL+"/api/admin/settings", map[string]bool{"moderation": true}, 200)
	in := studentInput("student-a")
	request(t, c, "POST", s.URL+"/api/messages", in, 201)
	public := snapshot(t, c, s.URL+"/api/state")
	if len(public.Messages) != 0 || public.Stats.Total != 0 || public.Stats.Pending != 0 {
		t.Fatal("unreviewed content leaked to public")
	}
	admin := snapshot(t, c, s.URL+"/api/admin/state")
	if admin.Stats.Pending != 1 || len(admin.Messages) != 1 {
		t.Fatal("teacher cannot see pending message")
	}
	m := admin.Messages[0]
	request(t, c, "PATCH", fmt.Sprintf("%s/api/admin/messages/%d", s.URL, m.ID), Input{Content: "中国医疗芯片", Category: "芯片", Nickname: "同学", Status: "approved"}, 200)
	public = snapshot(t, c, s.URL+"/api/state")
	if len(public.Messages) != 1 || public.Messages[0].Content != "中国医疗芯片" || public.Messages[0].ClientID != "" || public.Stats.Categories["芯片"] != 1 {
		t.Fatal("approval/edit/privacy failed")
	}
	request(t, c, "DELETE", fmt.Sprintf("%s/api/admin/messages/%d", s.URL, m.ID), nil, 200)
	public = snapshot(t, c, s.URL+"/api/state")
	if public.Stats.Approved != 0 || len(public.Messages) != 0 {
		t.Fatal("delete did not update public state")
	}
	// Deleting a message must release its idempotency pointer so a timed-out
	// student submission can be retried with the same submission id.
	time.Sleep(2100 * time.Millisecond)
	request(t, c, "POST", s.URL+"/api/messages", studentInput("student-a"), 201)
	request(t, c, "DELETE", fmt.Sprintf("%s/api/admin/messages/%d", s.URL, m.ID), nil, 404)
}
func TestSubmissionRetryPauseAndValidation(t *testing.T) {
	_, s, c := testApp(t)
	in := studentInput("student-a")
	request(t, c, "POST", s.URL+"/api/messages", in, 201)
	request(t, c, "POST", s.URL+"/api/messages", in, 200)
	if got := snapshot(t, c, s.URL+"/api/state").Stats.Total; got != 1 {
		t.Fatalf("retry duplicated message: %d", got)
	}
	in.SubmissionID = "second"
	request(t, c, "POST", s.URL+"/api/messages", in, 429)
	in = studentInput("student-b")
	in.Content = strings.Repeat("中", 81)
	request(t, c, "POST", s.URL+"/api/messages", in, 400)
	request(t, c, "PATCH", s.URL+"/api/admin/settings", map[string]string{"mode": "finale"}, 200)
	in = studentInput("student-b")
	request(t, c, "POST", s.URL+"/api/messages", in, 409)
	st := snapshot(t, c, s.URL+"/api/state")
	if st.Settings.Mode != "finale" || !st.Settings.Paused || st.Settings.FinaleAt == 0 {
		t.Fatal("finale not synchronized")
	}
	request(t, c, "PATCH", s.URL+"/api/admin/settings", map[string]string{"mode": "live"}, 200)
	request(t, c, "POST", s.URL+"/api/messages", in, 201)
	request(t, c, "GET", s.URL+"/api/admin/state", nil, 200)
}
func TestSSERealtimeAndCrossOrigin(t *testing.T) {
	_, s, c := testApp(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	r, _ := http.NewRequestWithContext(ctx, "GET", s.URL+"/api/events", nil)
	res, err := c.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	reader := bufio.NewScanner(res.Body)
	if !reader.Scan() || reader.Text() != "event: snapshot" {
		t.Fatal("missing initial SSE snapshot")
	}
	request(t, c, "POST", s.URL+"/api/messages", studentInput("sse-student"), 201)
	found := false
	for reader.Scan() {
		if reader.Text() == "event: message" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("new message did not arrive via SSE")
	}
	raw := bytes.NewBufferString(`{"paused":true}`)
	r, _ = http.NewRequest("PATCH", s.URL+"/api/admin/settings", raw)
	r.Header.Set("Origin", "https://untrusted.example")
	res2, err := c.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	res2.Body.Close()
	if res2.StatusCode != 403 {
		t.Fatal("cross origin mutation allowed")
	}
}
func TestConcurrentClassroomAndPersistence(t *testing.T) {
	file := filepath.Join(t.TempDir(), "classroom.db")
	a, err := newApp(file)
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewServer(a.routes())
	var wg sync.WaitGroup
	var errorsMu sync.Mutex
	var failures []string
	for i := 0; i < 60; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			in := studentInput(fmt.Sprintf("student-%d", i))
			raw, _ := json.Marshal(in)
			res, e := http.Post(s.URL+"/api/messages", "application/json", bytes.NewReader(raw))
			if e != nil {
				errorsMu.Lock()
				failures = append(failures, e.Error())
				errorsMu.Unlock()
				return
			}
			res.Body.Close()
			if res.StatusCode != 201 {
				errorsMu.Lock()
				failures = append(failures, fmt.Sprintf("status %d", res.StatusCode))
				errorsMu.Unlock()
			}
		}(i)
	}
	wg.Wait()
	if len(failures) > 0 {
		t.Error(failures)
	}
	a.mu.Lock()
	before, e := a.snapshotLocked(false)
	a.mu.Unlock()
	if e != nil {
		t.Fatal(e)
	}
	s.Close()
	a.db.Close()
	if before.Stats.Approved != 60 || before.Stats.Participants != 60 {
		t.Fatalf("lost concurrent messages: %+v", before.Stats)
	}
	reopened, e := newApp(file)
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.db.Close()
	after, e := reopened.snapshotLocked(false)
	if e != nil {
		t.Fatal(e)
	}
	if after.Stats.Approved != 60 || after.Settings.RoomName != before.Settings.RoomName {
		t.Fatal("restart lost classroom data")
	}
}

func readEvent(t *testing.T, reader *bufio.Scanner, expected string) json.RawMessage {
	t.Helper()
	var event string
	var data json.RawMessage
	for reader.Scan() {
		line := reader.Text()
		if strings.HasPrefix(line, "event: ") {
			event = strings.TrimPrefix(line, "event: ")
		}
		if strings.HasPrefix(line, "data: ") {
			data = json.RawMessage(strings.TrimPrefix(line, "data: "))
		}
		if line == "" {
			if event != expected {
				t.Fatalf("got SSE event %q, want %q", event, expected)
			}
			return data
		}
	}
	t.Fatalf("stream ended before %s: %v", expected, reader.Err())
	return nil
}

func TestClearMessagesWithoutLoginAndRealtime(t *testing.T) {
	a, s, c := testApp(t)
	// Neither teacher operations nor student submission require credentials/codes.
	request(t, c, "POST", s.URL+"/api/messages", studentInput("reset-student"), 201)
	request(t, c, "PATCH", s.URL+"/api/admin/settings", map[string]any{"roomName": "九年级科技课堂", "moderation": true}, 200)
	request(t, c, "POST", s.URL+"/api/messages", studentInput("pending-student"), 201)
	before := snapshot(t, c, s.URL+"/api/admin/state")
	if before.Stats.Total != 2 || before.Stats.Pending != 1 {
		t.Fatal("incorrect pre-clear classroom state")
	}
	lastID := before.Messages[len(before.Messages)-1].ID
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var readers []*bufio.Scanner
	for _, endpoint := range []string{"/api/events", "/api/admin/events"} {
		r, _ := http.NewRequestWithContext(ctx, "GET", s.URL+endpoint, nil)
		res, err := c.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatalf("unauthenticated stream status: %d", res.StatusCode)
		}
		reader := bufio.NewScanner(res.Body)
		readEvent(t, reader, "snapshot")
		readers = append(readers, reader)
	}
	request(t, c, "DELETE", s.URL+"/api/admin/messages", nil, 200)
	for _, reader := range readers {
		readEvent(t, reader, "clear")
		var stats Stats
		if err := json.Unmarshal(readEvent(t, reader, "stats"), &stats); err != nil {
			t.Fatal(err)
		}
		if stats.Total != 0 || stats.Approved != 0 || stats.Pending != 0 || stats.Participants != 0 || len(stats.Categories) != 0 {
			t.Fatal("stale statistics after clear")
		}
	}
	for _, endpoint := range []string{"/api/state", "/api/admin/state", "/api/admin/export"} {
		after := snapshot(t, c, s.URL+endpoint)
		if len(after.Messages) != 0 || after.Stats.Total != 0 {
			t.Fatal("clear left records behind")
		}
		if after.Settings.RoomName != "九年级科技课堂" || !after.Settings.Moderation {
			t.Fatal("clear changed classroom settings")
		}
	}
	if err := a.db.View(func(tx *bolt.Tx) error {
		if tx.Bucket([]byte("submissions")).Stats().KeyN != 0 {
			t.Fatal("stale submission index")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// A repeated clear is harmless; the same device can immediately submit again.
	request(t, c, "DELETE", s.URL+"/api/admin/messages", nil, 200)
	var posted struct {
		Message Message `json:"message"`
	}
	if err := json.Unmarshal(request(t, c, "POST", s.URL+"/api/messages", studentInput("reset-student"), 201), &posted); err != nil {
		t.Fatal(err)
	}
	if posted.Message.ID <= lastID {
		t.Fatal("clearing reused an old message id")
	}
}

func TestClearSurvivesRestart(t *testing.T) {
	file := filepath.Join(t.TempDir(), "classroom.db")
	a, err := newApp(file)
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewServer(a.routes())
	c := &http.Client{Timeout: 5 * time.Second}
	request(t, c, "POST", s.URL+"/api/messages", studentInput("restart-student"), 201)
	request(t, c, "DELETE", s.URL+"/api/admin/messages", nil, 200)
	s.Close()
	a.db.Close()
	reopened, err := newApp(file)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.db.Close()
	after, err := reopened.snapshotLocked(true)
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Messages) != 0 || after.Stats.Total != 0 {
		t.Fatal("restart restored cleared records")
	}
}

func TestHealthcheck(t *testing.T) {
	_, s, _ := testApp(t)
	_, port, err := net.SplitHostPort(strings.TrimPrefix(s.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	if err := healthcheck(port); err != nil {
		t.Fatal(err)
	}
}
