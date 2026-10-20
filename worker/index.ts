// 지구 탐사대 Worker — 정적 자산 + /api 라우팅 + 탐사실 Durable Object 중계.
import { RoomDO, type Env } from './room'
import { cookieHeader, clearCookieHeader, isValidRoomCode, normalizeRoomCode, parseCookies, participantCookieName, randomRoomCode, teacherCookieName } from './auth'
import { HttpError, RateLimiter, clientIp, errorResponse, isSameOrigin, json, readJson } from './http'
import { recentFeed } from './proxy'
import type { RoomSettings, RoomMeta } from '@shared/domain/types'
import { roomSettingsSchema } from '@shared/domain/schemas'

export { RoomDO }

const createLimiter = new RateLimiter(5, 5 / 60)
// 학교는 한 공인 IP 뒤에 40명이 있을 수 있다: 입장 60회 버스트, 분당 30회 보충
const joinLimiter = new RateLimiter(60, 30 / 60)
const apiLimiter = new RateLimiter(300, 10)

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) {
      // 정적 자산은 Workers Static Assets가 처리한다 (run_worker_first가 /api/* 에만 적용됨)
      return errorResponse(404, 'notFound', '없는 경로입니다.')
    }
    try {
      const res = await route(request, env, ctx, url)
      if (res.status === 101) return res // WebSocket 업그레이드 응답의 헤더는 수정할 수 없다
      const out = new Response(res.body, res)
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v)
      return out
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e.status, e.code, e.message)
      console.error('worker error', e)
      return errorResponse(500, 'internal', '서버 처리 중 오류가 났습니다. 잠시 후 다시 시도하세요.')
    }
  },
} satisfies ExportedHandler<Env>

async function route(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const path = url.pathname
  const method = request.method
  const ip = clientIp(request)
  const secure = url.protocol === 'https:'

  if (path === '/api/health') return json({ ok: true, time: new Date().toISOString(), env: env.APP_ENV ?? 'unknown' })

  if (!apiLimiter.take(ip)) return errorResponse(429, 'rateLimited', '요청이 너무 많습니다. 잠시 후 다시 시도하세요.', { 'retry-after': '10' })

  if (path === '/api/feed/recent' && method === 'GET') return recentFeed(request, ctx)

  if (path === '/api/teach/rooms' && method === 'POST') return createRoom(request, env, ip, secure)

  // /api/teach/rooms/:code/...
  const teachMatch = path.match(/^\/api\/teach\/rooms\/([A-Za-z0-9]{6})(\/[a-z]+)?$/)
  if (teachMatch) {
    const code = normalizeRoomCode(teachMatch[1])
    const sub = teachMatch[2] ?? ''
    const cookies = parseCookies(request.headers.get('cookie'))
    const stub = roomStub(env, code)
    const headers = new Headers()
    const teacherToken = cookies[teacherCookieName(code)]
    if (teacherToken) headers.set('x-ee-teacher-token', teacherToken)

    if (sub === '/recover' && method === 'POST') {
      if (!isSameOrigin(request)) return errorResponse(403, 'badOrigin', '허용되지 않은 출처입니다.')
      if (!joinLimiter.take(ip)) return errorResponse(429, 'rateLimited', '시도가 너무 많습니다.')
      const body = await readJson(request, 2000)
      const res = await stub.fetch(internal('/recover', { method: 'POST', body: JSON.stringify(body) }))
      if (!res.ok) return passthrough(res)
      const data = (await res.json()) as { meta: RoomMeta; sessionToken: string }
      const maxAge = Math.max(0, (data.meta.expiresAt - Date.now()) / 1000)
      return json({ code, meta: data.meta }, { headers: { 'set-cookie': cookieHeader(teacherCookieName(code), data.sessionToken, { maxAgeSec: maxAge, secure }) } })
    }
    if (sub === '/state' && method === 'GET') return passthrough(await stub.fetch(internal('/teacher/state', { headers })))
    if (sub === '/records' && method === 'GET') return passthrough(await stub.fetch(internal('/teacher/records', { headers })))
    if (sub === '/export' && method === 'GET') return passthrough(await stub.fetch(internal('/teacher/export?format=' + encodeURIComponent(url.searchParams.get('format') ?? 'json'), { headers })))
    if (sub === '' && method === 'DELETE') {
      if (!isSameOrigin(request)) return errorResponse(403, 'badOrigin', '허용되지 않은 출처입니다.')
      const res = await stub.fetch(internal('/teacher/delete', { method: 'POST', headers }))
      if (!res.ok) return passthrough(res)
      return json({ deleted: true }, { headers: { 'set-cookie': clearCookieHeader(teacherCookieName(code), secure) } })
    }
    return errorResponse(404, 'notFound', '없는 경로입니다.')
  }

  // /api/rooms/:code/...
  const roomMatch = path.match(/^\/api\/rooms\/([A-Za-z0-9]{6})(\/[a-z/_A-Za-z0-9-]+)?$/)
  if (roomMatch) {
    const code = normalizeRoomCode(roomMatch[1])
    if (!isValidRoomCode(code)) return errorResponse(400, 'badCode', '코드는 6자입니다.')
    const sub = roomMatch[2] ?? ''
    const cookies = parseCookies(request.headers.get('cookie'))
    const stub = roomStub(env, code)
    const headers = new Headers()
    const teacherToken = cookies[teacherCookieName(code)]
    const participantToken = cookies[participantCookieName(code)]
    if (teacherToken) headers.set('x-ee-teacher-token', teacherToken)
    if (participantToken) headers.set('x-ee-participant-token', participantToken)

    if (sub === '' && method === 'GET') return passthrough(await stub.fetch(internal('/info')))

    if (sub === '/join' && method === 'POST') {
      if (!isSameOrigin(request)) return errorResponse(403, 'badOrigin', '허용되지 않은 출처입니다.')
      if (!joinLimiter.take(ip)) return errorResponse(429, 'rateLimited', '입장 시도가 너무 많습니다. 잠시 후 다시 시도하세요.', { 'retry-after': '10' })
      const body = await readJson(request, 2000)
      const res = await stub.fetch(internal('/join', { method: 'POST', headers, body: JSON.stringify(body) }))
      if (!res.ok) return passthrough(res)
      const data = (await res.json()) as { participantId: string; nickname: string; group: string | null; reconnected: boolean; sessionToken: string | null; expiresAt: number }
      const out = json({ code, participantId: data.participantId, nickname: data.nickname, group: data.group, reconnected: data.reconnected, expiresAt: data.expiresAt })
      if (data.sessionToken) {
        const maxAge = Math.max(0, (data.expiresAt - Date.now()) / 1000)
        out.headers.set('set-cookie', cookieHeader(participantCookieName(code), data.sessionToken, { maxAgeSec: maxAge, secure }))
      }
      return out
    }
    if (sub === '/me' && method === 'GET') return passthrough(await stub.fetch(internal('/me', { headers })))
    if (sub === '/leave' && method === 'POST') {
      return json({ left: true }, { headers: { 'set-cookie': clearCookieHeader(participantCookieName(code), secure) } })
    }
    if (sub.startsWith('/report/') && method === 'GET') {
      const pid = sub.slice('/report/'.length)
      if (!/^p_[A-Za-z0-9_-]{6,20}$/.test(pid)) return errorResponse(400, 'badId', '잘못된 참가자 ID입니다.')
      return passthrough(await stub.fetch(internal('/report/' + pid, { headers })))
    }
    if (sub === '/ws') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return errorResponse(426, 'upgradeRequired', 'WebSocket 연결이 필요합니다.')
      if (!isSameOrigin(request)) return errorResponse(403, 'badOrigin', '허용되지 않은 출처입니다.')
      const as = url.searchParams.get('as') === 'teacher' ? 'teacher' : 'student'
      const wsReq = new Request(`https://room.internal/ws?as=${as}`, { headers: new Headers({ ...Object.fromEntries(headers), upgrade: 'websocket', connection: 'Upgrade' }) })
      return stub.fetch(wsReq)
    }
    return errorResponse(404, 'notFound', '없는 경로입니다.')
  }

  return errorResponse(404, 'notFound', '없는 경로입니다.')
}

function roomStub(env: Env, code: string) {
  return env.ROOM.get(env.ROOM.idFromName(code))
}

function internal(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return new Request('https://room.internal' + path, { ...init, headers })
}

async function passthrough(res: Response): Promise<Response> {
  const h = new Headers(res.headers)
  h.set('cache-control', 'no-store')
  return new Response(res.body, { status: res.status, headers: h })
}

async function createRoom(request: Request, env: Env, ip: string, secure: boolean): Promise<Response> {
  if (!isSameOrigin(request)) return errorResponse(403, 'badOrigin', '허용되지 않은 출처입니다.')
  if (!createLimiter.take(ip)) return errorResponse(429, 'rateLimited', '탐사실 생성 시도가 너무 많습니다. 1분 뒤에 다시 시도하세요.', { 'retry-after': '60' })
  const body = await readJson<{ settings: RoomSettings }>(request, 10_000)
  if (!body || typeof body !== 'object' || !body.settings) return errorResponse(400, 'badBody', '설정이 없습니다.')
  const settings = roomSettingsSchema.safeParse(body.settings)
  if (!settings.success) return errorResponse(400, 'badSettings', '수업 설정을 확인해 주세요.')

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomRoomCode()
    const res = await roomStub(env, code).fetch(internal('/create', { method: 'POST', body: JSON.stringify({ code, settings: settings.data }) }))
    if (res.status === 409) continue
    if (!res.ok) return passthrough(res)
    const data = (await res.json()) as { meta: RoomMeta; sessionToken: string; recoveryToken: string }
    const maxAge = Math.max(0, (data.meta.expiresAt - Date.now()) / 1000)
    return json(
      { code, meta: data.meta, recoveryToken: data.recoveryToken },
      { status: 201, headers: { 'set-cookie': cookieHeader(teacherCookieName(code), data.sessionToken, { maxAgeSec: maxAge, secure }) } },
    )
  }
  return errorResponse(503, 'codeCollision', '입장 코드를 만들지 못했습니다. 다시 시도하세요.')
}
