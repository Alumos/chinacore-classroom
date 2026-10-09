import { useEffect, useState } from 'react'

export const fields = ['医疗', '交通', '能源', '农业', '人工智能', '芯片', '航空航天', '其他'] as const
export type Message = { id: number; content: string; category: string; nickname: string; status: 'approved' | 'pending'; createdAt: number }
export type Settings = { roomName: string; paused: boolean; moderation: boolean; mode: 'live' | 'finale'; finaleAt: number }
export type Stats = { total: number; approved: number; pending: number; participants: number; categories: Record<string, number> }
export type Snapshot = { messages: Message[]; settings: Settings; stats: Stats; joinURLs: string[] }
export const emptyState: Snapshot = { messages: [], settings: { roomName: '未来科技课堂', paused: false, moderation: false, mode: 'live', finaleAt: 0 }, stats: { total: 0, approved: 0, pending: 0, participants: 0, categories: {} }, joinURLs: [] }
export class ApiError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status } }
export async function api<T = unknown>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error || '连接失败，请稍后重试', res.status)
  return data as T
}
export function useClassroom(admin = false) {
  const [state, setState] = useState<Snapshot>(emptyState)
  const [connected, setConnected] = useState(false)
  const [ready, setReady] = useState(false)
  const [clearVersion, setClearVersion] = useState(0)
  useEffect(() => {
    const es = new EventSource(admin ? '/api/admin/events' : '/api/events')
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    const listen = (event: string, fn: (data: any) => void) => es.addEventListener(event, e => { try { fn(JSON.parse((e as MessageEvent).data)) } catch { /* Reconnection replaces any incomplete event. */ } })
    listen('snapshot', data => { setState(data); setReady(true) })
    listen('message', (message: Message) => setState(s => { const messages = [...s.messages.filter(m => m.id !== message.id), message].sort((a, b) => a.id - b.id); return { ...s, messages: admin ? messages : messages.slice(-240) } }))
    listen('delete', data => setState(s => ({ ...s, messages: s.messages.filter(m => m.id !== data.id) })))
    listen('clear', () => { setState(s => ({ ...s, messages: [], stats: { ...emptyState.stats, categories: {} } })); setClearVersion(v => v + 1) })
    listen('settings', settings => setState(s => ({ ...s, settings })))
    listen('stats', stats => setState(s => ({ ...s, stats })))
    return () => { es.close(); setConnected(false) }
  }, [admin])
  return { state, connected, ready, clearVersion }
}
export function clientID() {
  let id = localStorage.getItem('chip-client-id')
  if (!id) { id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; localStorage.setItem('chip-client-id', id) }
  return id
}
export function newSubmissionID() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}` }
export const sampleMessages: Message[] = [
  ['人工智能', '让中国的人工智能拥有自己的核心算法'], ['医疗', '高端医疗设备，让健康更有保障'], ['芯片', '把芯片的主动权牢牢握在自己手中'], ['能源', '让清洁能源成为我们的底气'], ['农业', '种子是农业的“芯片”'], ['交通', '高铁与智能交通，中国速度再出发'], ['航空航天', '探索星辰大海，关键技术自主可控'], ['人工智能', '用自主创新，点亮科技未来'], ['医疗', '研发我们自己的创新药'], ['农业', '守护粮食安全，让中国种子更强'], ['芯片', '中国芯，强国梦！'], ['能源', '突破储能技术，让未来更绿色'],
].map(([category, content], i) => ({ id: -i - 1, category, content, nickname: '演示同学', status: 'approved', createdAt: 0 }))
