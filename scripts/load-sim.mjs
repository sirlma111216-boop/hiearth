// 교실 통신 부하 시뮬레이션 — 로컬 dev 서버(localhost)에만 실행한다. 공공 API에는 부하를 주지 않는다.
// 실행: node scripts/load-sim.mjs [학생수=40] [기준주소=http://localhost:5173]
// 교사 1 + 학생 N: 입장 → WS 접속 → 동시에 최초 추론 제출 → 교사 단계 변경 → 전체 브로드캐스트 수신 시간 측정.
import WebSocket from 'ws'

const N = Number(process.argv[2] ?? 40)
const BASE = process.argv[3] ?? 'http://localhost:5173'
const ORIGIN = BASE
const log = (...a) => console.log('[load-sim]', ...a)

const cookieOf = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0]
const guessFor = (i) => ({ lines: [{ id: 'l' + i, points: Array.from({ length: 30 }, (_, k) => [130 + k * 0.5 + (i % 7), 20 + k * 0.6 + (i % 5)]), mode: 'freehand', rawPointCount: 120 }] })

async function main() {
  const t0 = performance.now()
  const create = await fetch(`${BASE}/api/teach/rooms`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ settings: { title: '부하 시험', datasetId: 'usgs-lesson-2015-2025-m5', startRegion: 'world', maxParticipants: Math.max(N, 1), ttlMs: 3600_000, groups: [] } }) })
  if (!create.ok) throw new Error('create failed ' + create.status + ' ' + (await create.text()))
  const teacherCookie = cookieOf(create)
  const { code } = await create.json()
  log('탐사실', code)

  // 입장 (제한: 분당 12/IP → 로컬에서는 cf-connecting-ip가 없어 'local' 키 하나이므로 순차 입장은 제한에 걸린다.
  // 서버 제한을 검증하려는 것이 아니므로 x-forwarded-for로 학생마다 다른 IP를 흉내 낸다.)
  const students = []
  for (let i = 0; i < N; i++) {
    const res = await fetch(`${BASE}/api/rooms/${code}/join`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': `10.9.${(i >> 8) & 255}.${i & 255}` }, body: JSON.stringify({ nickname: '학생' + (i + 1) }) })
    if (!res.ok) throw new Error(`join ${i} failed ${res.status} ${await res.text()}`)
    students.push({ i, cookie: cookieOf(res), body: await res.json() })
  }
  log(`입장 ${N}명 완료 ${(performance.now() - t0).toFixed(0)}ms`)

  const wsUrl = BASE.replace(/^http/, 'ws')
  const open = (cookie, as) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}/api/rooms/${code}/ws?as=${as}`, { headers: { cookie, origin: ORIGIN } })
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', (e) => reject(new Error('ws error ' + (e.message ?? ''))))
  })
  const teacherWs = await open(teacherCookie, 'teacher')
  const t1 = performance.now()
  const sockets = await Promise.all(students.map((s) => open(s.cookie, 'student')))
  log(`WS ${N}개 접속 ${(performance.now() - t1).toFixed(0)}ms`)

  const stats = { snapshots: 0, bytes: 0, maxSnapshot: 0 }
  for (const ws of sockets) ws.addEventListener('message', (ev) => { if (typeof ev.data === 'string') { stats.bytes += ev.data.length; if (ev.data.startsWith('{"type":"snapshot"')) { stats.snapshots++; stats.maxSnapshot = Math.max(stats.maxSnapshot, ev.data.length) } } })

  const send = (ws, msg) => new Promise((resolve) => {
    const id = 'm' + Math.random().toString(36).slice(2)
    const started = performance.now()
    const h = (ev) => { if (typeof ev.data !== 'string') return; const m = JSON.parse(ev.data); if (m.type === 'ack' && m.clientMessageId === id) { ws.removeEventListener('message', h); resolve({ ok: m.ok, ms: performance.now() - started, error: m.error }) } }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ v: 1, clientMessageId: id, ...msg }))
  })

  const stageAck = await send(teacherWs, { type: 'teacher:setStage', stage: 'firstGuess' })
  log('교사 단계 변경 ack', stageAck.ok, stageAck.ms.toFixed(0) + 'ms')
  await new Promise((r) => setTimeout(r, 500))

  const t2 = performance.now()
  const acks = await Promise.all(sockets.map((ws, i) => send(ws, { type: 'submitGuess', kind: 'first', guess: guessFor(i), idempotencyKey: 'load-' + code + '-' + i + '-' + Date.now(), datasetVersion: 'load' })))
  const ms = acks.map((a) => a.ms).sort((a, b) => a - b)
  log(`동시 제출 ${N}건: 성공 ${acks.filter((a) => a.ok).length}, 전체 ${(performance.now() - t2).toFixed(0)}ms, ack 중앙값 ${ms[Math.floor(ms.length / 2)].toFixed(0)}ms, 최대 ${ms[ms.length - 1].toFixed(0)}ms`)
  const fails = acks.filter((a) => !a.ok)
  if (fails.length) log('실패 예시', fails[0].error)

  // 공개 후 브로드캐스트 크기
  stats.snapshots = 0; stats.bytes = 0; stats.maxSnapshot = 0
  const t3 = performance.now()
  await send(teacherWs, { type: 'teacher:reveal', what: 'firstGuesses', value: true })
  await new Promise((r) => setTimeout(r, 1500))
  log(`공개 브로드캐스트: ${(performance.now() - t3 - 1500).toFixed(0)}ms 뒤 1.5초 동안 학생 스냅샷 ${stats.snapshots}개, 총 ${(stats.bytes / 1024).toFixed(0)}KB, 최대 스냅샷 ${(stats.maxSnapshot / 1024).toFixed(1)}KB`)

  const state = await fetch(`${BASE}/api/teach/rooms/${code}/state`, { headers: { cookie: teacherCookie } }).then((r) => r.json())
  log(`교사 상태: 참가 ${state.participants.length}, 접속 ${state.participants.filter((p) => p.connected).length}, 최초 추론 ${state.participants.filter((p) => p.hasFirst).length}`)

  for (const ws of sockets) ws.close()
  teacherWs.close()
  await fetch(`${BASE}/api/teach/rooms/${code}`, { method: 'DELETE', headers: { cookie: teacherCookie, origin: ORIGIN } })
  log('정리 완료')
}
main().catch((e) => { console.error(e); process.exit(1) })
