// 탐사실 WebSocket 클라이언트 — 재연결, 전송 대기열, 스냅샷 통째 수용.
import type { ClientMessage, ServerMessage, Snapshot, AckMessage, NoticeMessage } from '@shared/protocol/messages'
import { PROTOCOL_VERSION } from '@shared/protocol/messages'
import { newId } from '../inquiry/ids'

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type Outgoing = DistributiveOmit<ClientMessage, 'v' | 'clientMessageId'>

interface PendingItem {
  msg: ClientMessage
  resolve: (ack: AckMessage) => void
  reject: (e: Error) => void
  sent: boolean
  timer: ReturnType<typeof setTimeout> | null
}

export interface RoomClientOptions {
  code: string
  as: 'student' | 'teacher'
  onSnapshot: (s: Snapshot) => void
  onNotice: (n: NoticeMessage) => void
  onState: (s: ConnectionState, detail?: string) => void
  onClosedForGood?: (code: number, reason: string) => void
}

const ACK_TIMEOUT_MS = 12_000

export class RoomClient {
  private ws: WebSocket | null = null
  private state: ConnectionState = 'idle'
  private pending = new Map<string, PendingItem>()
  private retry = 0
  private closedByUser = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  lastServerTime = 0
  lastRevision = 0

  constructor(private opts: RoomClientOptions) {}

  getState() { return this.state }

  connect() {
    this.closedByUser = false
    this.open()
  }

  private setState(s: ConnectionState, detail?: string) {
    this.state = s
    this.opts.onState(s, detail)
  }

  private url() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${location.host}/api/rooms/${this.opts.code}/ws?as=${this.opts.as}`
  }

  private open() {
    if (this.ws) { try { this.ws.close() } catch { /* noop */ } }
    this.setState(this.retry === 0 ? 'connecting' : 'reconnecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(this.url())
    } catch (e) {
      this.scheduleReconnect(String(e))
      return
    }
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.setState('open')
      // 보류 메시지 재전송 (idempotency key로 중복 방지)
      for (const item of this.pending.values()) this.flush(item)
      this.pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping') }, 25_000)
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data === 'pong') return
      let msg: ServerMessage
      try { msg = JSON.parse(ev.data) as ServerMessage } catch { return }
      if (msg.type === 'snapshot') {
        // 오래된 스냅샷(순서 뒤바뀜)은 무시
        if (msg.roomRevision < this.lastRevision && msg.serverTime < this.lastServerTime) return
        this.lastRevision = msg.roomRevision
        this.lastServerTime = msg.serverTime
        this.opts.onSnapshot(msg)
      } else if (msg.type === 'ack') {
        const item = this.pending.get(msg.clientMessageId)
        if (item) {
          if (item.timer) clearTimeout(item.timer)
          this.pending.delete(msg.clientMessageId)
          item.resolve(msg)
        }
      } else if (msg.type === 'notice') {
        this.opts.onNotice(msg)
      }
    }
    ws.onclose = (ev) => {
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
      if (this.closedByUser) { this.setState('closed'); return }
      // 4001 만료, 4003 삭제, 4004 내보냄, 4002 종료/없음: 다시 연결하지 않는다
      if ([4001, 4002, 4003, 4004].includes(ev.code)) {
        this.setState('closed', ev.reason)
        this.rejectAll(new Error('연결이 종료되었습니다: ' + ev.reason))
        this.opts.onClosedForGood?.(ev.code, ev.reason)
        return
      }
      this.scheduleReconnect(ev.reason)
    }
    ws.onerror = () => { /* onclose가 뒤따른다 */ }
  }

  private scheduleReconnect(detail?: string) {
    if (this.closedByUser) return
    this.retry++
    const delay = Math.min(15_000, 600 * Math.pow(1.8, this.retry - 1)) + Math.random() * 400
    this.setState('reconnecting', detail)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => this.open(), delay)
  }

  private rejectAll(e: Error) {
    for (const item of this.pending.values()) { if (item.timer) clearTimeout(item.timer); item.reject(e) }
    this.pending.clear()
  }

  private flush(item: PendingItem) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(item.msg))
    item.sent = true
    if (item.timer) clearTimeout(item.timer)
    item.timer = setTimeout(() => {
      // 응답이 없으면 재전송 (서버는 idempotency key로 중복을 거른다)
      if (this.pending.has(item.msg.clientMessageId)) { item.sent = false; this.flush(item) }
    }, ACK_TIMEOUT_MS)
  }

  /** 메시지를 보내고 서버 확인(ack)을 기다린다. 연결이 없으면 대기열에 둔다. */
  send(out: Outgoing, onQueued?: () => void): Promise<AckMessage> {
    const msg = { ...out, v: PROTOCOL_VERSION, clientMessageId: newId('m') } as ClientMessage
    return new Promise<AckMessage>((resolve, reject) => {
      const item: PendingItem = { msg, resolve, reject, sent: false, timer: null }
      this.pending.set(msg.clientMessageId, item)
      if (this.ws?.readyState === WebSocket.OPEN) this.flush(item)
      else onQueued?.()
    })
  }

  get queuedCount() { return [...this.pending.values()].filter((p) => !p.sent).length }

  close() {
    this.closedByUser = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    try { this.ws?.close(1000, 'bye') } catch { /* noop */ }
    this.ws = null
    this.setState('closed')
  }
}
