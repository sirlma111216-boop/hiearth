// Workers 실행 환경(workerd)에서 Durable Object 탐사실을 검증한다.
import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

const ORIGIN = 'http://example.com'
function cookieOf(res: Response): string {
  const sc = res.headers.get('set-cookie') ?? ''
  return sc.split(';')[0]
}

async function createRoom(settings: Record<string, unknown> = {}) {
  const res = await SELF.fetch(`${ORIGIN}/api/teach/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': `10.0.0.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({ settings: { title: '테스트 탐사실', datasetId: 'usgs-lesson-2015-2025-m5', startRegion: 'world', maxParticipants: 3, ttlMs: 3_600_000, groups: ['1모둠', '2모둠'], ...settings } }),
  })
  const body = (await res.json()) as { code: string; recoveryToken: string; meta: { expiresAt: number } }
  return { res, body, cookie: cookieOf(res) }
}

async function join(code: string, nickname: string, extra: RequestInit = {}) {
  const res = await SELF.fetch(`${ORIGIN}/api/rooms/${code}/join`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(extra.headers ?? {}) },
    body: JSON.stringify({ nickname }),
  })
  return { res, body: (await res.json()) as { participantId: string; nickname: string; reconnected: boolean }, cookie: cookieOf(res) }
}

// 수신함: accept() 직후 도착하는 메시지를 놓치지 않도록 리스너를 먼저 단다
const inbox = new WeakMap<WebSocket, { queue: string[]; waiters: (() => void)[] }>()

async function ws(code: string, as: 'student' | 'teacher', cookie: string): Promise<WebSocket> {
  const res = await SELF.fetch(`${ORIGIN}/api/rooms/${code}/ws?as=${as}`, { headers: { upgrade: 'websocket', origin: ORIGIN, cookie } })
  expect(res.status).toBe(101)
  const socket = res.webSocket!
  const box = { queue: [] as string[], waiters: [] as (() => void)[] }
  inbox.set(socket, box)
  socket.addEventListener('message', (ev) => { box.queue.push(ev.data as string); for (const w of box.waiters.splice(0)) w() })
  socket.accept()
  return socket
}

function nextMessage<T = unknown>(socket: WebSocket, pred: (m: T) => boolean, timeout = 5000): Promise<T> {
  const box = inbox.get(socket)!
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout
    const check = () => {
      for (let i = 0; i < box.queue.length; i++) {
        const m = JSON.parse(box.queue[i]) as T
        if (pred(m)) { box.queue.splice(0, i + 1); return resolve(m) }
      }
      if (Date.now() > deadline) return reject(new Error('timeout waiting for message: ' + pred.toString()))
      box.waiters.push(check)
      setTimeout(() => { if (box.waiters.includes(check)) { box.waiters.splice(box.waiters.indexOf(check), 1); check() } }, Math.max(1, Math.min(250, deadline - Date.now())))
    }
    check()
  })
}

const drain = (socket: WebSocket) => { inbox.get(socket)!.queue.length = 0 }

let msgSeq = 0
function send(socket: WebSocket, msg: Record<string, unknown>) {
  const clientMessageId = 'm' + ++msgSeq
  socket.send(JSON.stringify({ v: 1, clientMessageId, ...msg }))
  return nextMessage<{ type: string; clientMessageId: string; ok: boolean; duplicate?: boolean; error?: { code: string } }>(socket, (m) => m.type === 'ack' && m.clientMessageId === clientMessageId)
}

const guess = { lines: [{ id: 'l1', points: [[139, 35], [141, 40], [143, 44]], mode: 'polyline', rawPointCount: 3 }] }

describe('탐사실 생성과 권한', () => {

  it('잘못된 설정은 생성 전에 거절한다', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/teach/rooms`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-teacher-key': 'wrong' }, body: JSON.stringify({ settings: {} }) })
    expect(res.status).toBe(400)
  })
  it('다른 출처의 생성 요청은 거부한다', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/teach/rooms`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: JSON.stringify({ settings: {} }) })
    expect(res.status).toBe(403)
  })
  it('생성 → 공개 정보 → 교사 상태', async () => {
    const { res, body, cookie } = await createRoom()
    expect(res.status).toBe(201)
    expect(body.code).toMatch(/^[A-Z0-9]{6}$/)
    expect(res.headers.get('set-cookie')).toContain('HttpOnly')
    expect(body.recoveryToken.length).toBeGreaterThan(20)
    const info = await SELF.fetch(`${ORIGIN}/api/rooms/${body.code}`)
    expect(info.status).toBe(200)
    const infoBody = (await info.json()) as { title: string; participantCount: number }
    expect(infoBody.title).toBe('테스트 탐사실')
    expect(infoBody.participantCount).toBe(0)
    const state = await SELF.fetch(`${ORIGIN}/api/teach/rooms/${body.code}/state`, { headers: { cookie } })
    expect(state.status).toBe(200)
    const noAuth = await SELF.fetch(`${ORIGIN}/api/teach/rooms/${body.code}/state`)
    expect(noAuth.status).toBe(401)
  })
  it('없는 코드는 404', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/rooms/ZZZZZ9`)
    expect(res.status).toBe(404)
  })
  it('복구 토큰으로 교사 세션을 다시 받는다', async () => {
    const { body } = await createRoom()
    const bad = await SELF.fetch(`${ORIGIN}/api/teach/rooms/${body.code}/recover`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ recoveryToken: 'nope' }) })
    expect(bad.status).toBe(401)
    const ok = await SELF.fetch(`${ORIGIN}/api/teach/rooms/${body.code}/recover`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ recoveryToken: body.recoveryToken }) })
    expect(ok.status).toBe(200)
    const state = await SELF.fetch(`${ORIGIN}/api/teach/rooms/${body.code}/state`, { headers: { cookie: cookieOf(ok) } })
    expect(state.status).toBe(200)
  })
})

describe('입장과 정원', () => {
  it('별명 검증·정원·재입장', async () => {
    const { body } = await createRoom({ maxParticipants: 2 })
    const bad = await join(body.code, '<<<')
    expect(bad.res.status).toBe(400)
    const a = await join(body.code, '학생A')
    expect(a.res.status).toBe(200)
    expect(a.cookie.startsWith('eep_' + body.code)).toBe(true)
    const b = await join(body.code, '학생B')
    expect(b.res.status).toBe(200)
    const c = await join(body.code, '학생C')
    expect(c.res.status).toBe(409)
    // 같은 세션으로 재입장하면 새 참가자를 만들지 않는다
    const again = await join(body.code, '학생A', { headers: { cookie: a.cookie } })
    expect(again.body.reconnected).toBe(true)
    expect(again.body.participantId).toBe(a.body.participantId)
    const me = await SELF.fetch(`${ORIGIN}/api/rooms/${body.code}/me`, { headers: { cookie: a.cookie } })
    expect(me.status).toBe(200)
    const snap = (await me.json()) as { me: { nickname: string }; sharedGuesses: unknown[] }
    expect(snap.me.nickname).toBe('학생A')
    expect(snap.sharedGuesses).toEqual([])
  })
})

describe('WebSocket 규약', () => {
  it('학생 제출: idempotency, 최초 불변, 공개 전 비노출, 교사 이벤트 거부', async () => {
    const room = await createRoom()
    const code = room.body.code
    const a = await join(code, '학생A')
    const b = await join(code, '학생B')
    const sa = await ws(code, 'student', a.cookie)
    const sb = await ws(code, 'student', b.cookie)
    const st = await ws(code, 'teacher', room.cookie)
    await nextMessage<{ type: string }>(sa, (m) => m.type === 'snapshot')
    await nextMessage<{ type: string }>(sb, (m) => m.type === 'snapshot')
    await nextMessage<{ type: string }>(st, (m) => m.type === 'snapshot')

    // 아직 단계가 observe → 제출 거부
    const early = await send(sa, { type: 'submitGuess', kind: 'first', guess, idempotencyKey: 'k-early-0001', datasetVersion: 'ds' })
    expect(early.ok).toBe(false)
    expect(early.error?.code).toBe('tooEarly')

    // 학생이 교사 이벤트를 보내면 거부
    const forged = await send(sa, { type: 'teacher:setStage', stage: 'firstGuess' })
    expect(forged.ok).toBe(false)

    // 교사가 단계를 연다
    const open = await send(st, { type: 'teacher:setStage', stage: 'firstGuess' })
    expect(open.ok).toBe(true)
    await nextMessage<{ type: string; room: { stage: string } }>(sa, (m) => m.type === 'snapshot' && m.room.stage === 'firstGuess')

    const first = await send(sa, { type: 'submitGuess', kind: 'first', guess, idempotencyKey: 'k-first-00001', datasetVersion: 'ds' })
    expect(first.ok).toBe(true)
    expect(first.duplicate).toBeUndefined()
    // 같은 키 재전송 → duplicate
    const dup = await send(sa, { type: 'submitGuess', kind: 'first', guess, idempotencyKey: 'k-first-00001', datasetVersion: 'ds' })
    expect(dup.ok).toBe(true)
    expect(dup.duplicate).toBe(true)
    // 다른 키로 다시 최초 제출 → 덮어쓰지 않음
    const other = { lines: [{ id: 'l2', points: [[0, 0], [1, 1]], mode: 'polyline', rawPointCount: 2 }] }
    const again = await send(sa, { type: 'submitGuess', kind: 'first', guess: other, idempotencyKey: 'k-first-00002', datasetVersion: 'ds' })
    expect(again.duplicate).toBe(true)

    // 공개 전: B의 스냅샷에 A의 선이 없다
    drain(sb)
    const pB = nextMessage<{ type: string; sharedGuesses: unknown[] }>(sb, (m) => m.type === 'snapshot')
    await send(sb, { type: 'resync' })
    const snapB = await pB
    expect(snapB.sharedGuesses).toEqual([])
    // 교사는 본다
    drain(st)
    const pT = nextMessage<{ type: string; sharedGuesses: { participantId: string; guess: typeof guess }[] }>(st, (m) => m.type === 'snapshot')
    await send(st, { type: 'resync' })
    const snapT = await pT
    expect(snapT.sharedGuesses).toHaveLength(1)
    expect(snapT.sharedGuesses[0].guess.lines[0].id).toBe('l1')

    // 공개 후 B가 본다 (별명은 공개 전이므로 null)
    await send(st, { type: 'teacher:reveal', what: 'firstGuesses', value: true })
    const snapB2 = await nextMessage<{ type: string; sharedGuesses: { nickname: string | null }[] }>(sb, (m) => m.type === 'snapshot' && (m as { sharedGuesses: unknown[] }).sharedGuesses.length > 0)
    expect(snapB2.sharedGuesses[0].nickname).toBeNull()

    // 잘못된 메시지
    const badAck = await send(sa, { type: 'submitGuess', kind: 'first', guess: { lines: [] }, idempotencyKey: 'k-bad-000001', datasetVersion: 'ds' })
    expect(badAck.ok).toBe(false)
    expect(badAck.error?.code).toBe('badMessage')

    // 입력 잠금
    await send(st, { type: 'teacher:lockInput', locked: true })
    await nextMessage<{ type: string; room: { inputLocked: boolean } }>(sa, (m) => m.type === 'snapshot' && m.room.inputLocked)
    const locked = await send(sa, { type: 'saveExplanation', explanation: { text: 'x', limitations: 'y' } })
    expect(locked.error?.code).toBe('inputLocked')
    await send(st, { type: 'teacher:lockInput', locked: false })

    // 수정 단계 전 수정 제출 거부, 단계 후 허용
    const tooEarly = await send(sa, { type: 'submitGuess', kind: 'revised', guess, idempotencyKey: 'k-rev-0000001', datasetVersion: 'ds' })
    expect(tooEarly.error?.code).toBe('tooEarly')
    await send(st, { type: 'teacher:setStage', stage: 'revise' })
    await nextMessage<{ type: string; room: { stage: string } }>(sa, (m) => m.type === 'snapshot' && m.room.stage === 'revise')
    const rev = await send(sa, { type: 'submitGuess', kind: 'revised', guess: other, idempotencyKey: 'k-rev-0000002', datasetVersion: 'ds' })
    expect(rev.ok).toBe(true)

    // 보고서 권한: A는 자기 것만, B는 A 것 불가, 교사는 모두
    const repA = await SELF.fetch(`${ORIGIN}/api/rooms/${code}/report/${a.body.participantId}`, { headers: { cookie: a.cookie } })
    expect(repA.status).toBe(200)
    const repBody = (await repA.json()) as { record: { firstGuess: { guess: typeof guess }; revisedGuess: { guess: typeof other } } }
    expect(repBody.record.firstGuess.guess.lines[0].id).toBe('l1')
    expect(repBody.record.revisedGuess.guess.lines[0].id).toBe('l2')
    const repB = await SELF.fetch(`${ORIGIN}/api/rooms/${code}/report/${a.body.participantId}`, { headers: { cookie: b.cookie } })
    expect(repB.status).toBe(403)
    const repT = await SELF.fetch(`${ORIGIN}/api/rooms/${code}/report/${a.body.participantId}`, { headers: { cookie: room.cookie } })
    expect(repT.status).toBe(200)

    // 다른 방 쿠키로 접근 불가
    const other2 = await createRoom()
    const cross = await SELF.fetch(`${ORIGIN}/api/rooms/${other2.body.code}/me`, { headers: { cookie: a.cookie.replace(code, other2.body.code) } })
    expect(cross.status).toBe(401)

    // CSV 내보내기에 수식 주입 방지 적용
    await send(sa, { type: 'saveExplanation', explanation: { text: '=HYPERLINK("x")', limitations: 'ok' } })
    const csv = await SELF.fetch(`${ORIGIN}/api/teach/rooms/${code}/export?format=csv`, { headers: { cookie: room.cookie } })
    const text = await csv.text()
    expect(text).toContain("'=HYPERLINK")

    sa.close(); sb.close(); st.close()
  })

  it('내보내기·종료·삭제 후 접속 거부', async () => {
    const room = await createRoom()
    const code = room.body.code
    const a = await join(code, '학생A')
    const st = await ws(code, 'teacher', room.cookie)
    await nextMessage<{ type: string }>(st, (m) => m.type === 'snapshot')
    const sa = await ws(code, 'student', a.cookie)
    await nextMessage<{ type: string }>(sa, (m) => m.type === 'snapshot')
    const closed = new Promise<number>((res) => sa.addEventListener('close', (ev) => res(ev.code)))
    await send(st, { type: 'teacher:remove', participantId: a.body.participantId })
    expect(await closed).toBe(4004)
    const me = await SELF.fetch(`${ORIGIN}/api/rooms/${code}/me`, { headers: { cookie: a.cookie } })
    expect(me.status).toBe(401)

    await send(st, { type: 'teacher:end' })
    const b = await join(code, '학생B')
    expect(b.res.status).toBe(409)

    const del = await SELF.fetch(`${ORIGIN}/api/teach/rooms/${code}`, { method: 'DELETE', headers: { cookie: room.cookie, origin: ORIGIN } })
    expect(del.status).toBe(200)
    const info = await SELF.fetch(`${ORIGIN}/api/rooms/${code}`)
    expect(info.status).toBe(404)
    const state = await SELF.fetch(`${ORIGIN}/api/teach/rooms/${code}/state`, { headers: { cookie: room.cookie } })
    expect([401, 404]).toContain(state.status)
  })

  it('WebSocket 메시지 크기·형식 제한', async () => {
    const room = await createRoom()
    const a = await join(room.body.code, '학생A')
    const sa = await ws(room.body.code, 'student', a.cookie)
    await nextMessage<{ type: string }>(sa, (m) => m.type === 'snapshot')
    sa.send('not json')
    const ack = await nextMessage<{ type: string; ok: boolean; error?: { code: string } }>(sa, (m) => m.type === 'ack')
    expect(ack.ok).toBe(false)
    expect(ack.error?.code).toBe('badJson')
    sa.close()
  })
})

describe('수업 화면 이동', () => {
  it('교사가 화면을 옮기면 활동 상태와 공개가 따라오고 학생은 보낼 수 없다', async () => {
    const room = await createRoom()
    const code = room.body.code
    const a = await join(code, '학생A')
    const st = await ws(code, 'teacher', room.cookie)
    const sa = await ws(code, 'student', a.cookie)
    await nextMessage<{ type: string }>(st, (m) => m.type === 'snapshot')
    const first = await nextMessage<{ type: string; room: { screen: { step: number; sub: number } } }>(sa, (m) => m.type === 'snapshot')
    expect(first.room.screen).toEqual({ step: 3, sub: 1 })
    const forged = await send(sa, { type: 'teacher:setScreen', screen: { step: 6, sub: 5 } })
    expect(forged.ok).toBe(false)
    const bad = await send(st, { type: 'teacher:setScreen', screen: { step: 99, sub: 1 } })
    expect(bad.ok).toBe(false)
    const ok = await send(st, { type: 'teacher:setScreen', screen: { step: 6, sub: 5 } })
    expect(ok.ok).toBe(true)
    const snap = await nextMessage<{ type: string; room: { screen: { step: number }; stage: string; revealed: { volcanoes: boolean; firstGuesses: boolean } } }>(sa, (m) => m.type === 'snapshot' && (m as { room: { screen: { step: number } } }).room.screen.step === 6)
    expect(snap.room.stage).toBe('revise')
    expect(snap.room.revealed.volcanoes).toBe(true)
    expect(snap.room.revealed.firstGuesses).toBe(false)
    // 화면 응답 저장
    const resp = await send(sa, { type: 'saveResponses', responses: { 'observe-world': { text: '띠처럼 모여 있다', choices: ['특정한 곳에 띠처럼 길게 이어진다'], updatedAt: Date.now() } } })
    expect(resp.ok).toBe(true)
    const rep = await SELF.fetch(`${ORIGIN}/api/rooms/${code}/report/${a.body.participantId}`, { headers: { cookie: a.cookie } })
    const body = (await rep.json()) as { record: { responses: Record<string, { text: string }> } }
    expect(body.record.responses['observe-world'].text).toBe('띠처럼 모여 있다')
    sa.close(); st.close()
  })
})

describe('만료 알람', () => {
  it('만료 시각이 지나면 자료가 정리된다', async () => {
    const room = await createRoom({ ttlMs: 30 * 60 * 1000 })
    const code = room.body.code
    const id = (env as unknown as { ROOM: DurableObjectNamespace }).ROOM.idFromName(code)
    const stub = (env as unknown as { ROOM: DurableObjectNamespace }).ROOM.get(id)
    // 알람을 강제로 실행하기 위해 만료 시각을 과거로 돌린 뒤 alarm() 호출
    const { runInDurableObject, runDurableObjectAlarm } = await import('cloudflare:test')
    await runInDurableObject(stub, async (_instance, state) => {
      const row = state.storage.sql.exec<{ v: string }>(`SELECT v FROM kv WHERE k = 'meta'`).toArray()[0]
      const meta = JSON.parse(row.v)
      meta.expiresAt = Date.now() - 1000
      state.storage.sql.exec(`UPDATE kv SET v = ? WHERE k = 'meta'`, JSON.stringify(meta))
      await state.storage.setAlarm(Date.now() - 500)
    })
    const ran = await runDurableObjectAlarm(stub)
    expect(ran).toBe(true)
    const info = await SELF.fetch(`${ORIGIN}/api/rooms/${code}`)
    expect(info.status).toBe(404)
  })
})
