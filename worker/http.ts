export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function errorResponse(status: number, code: string, message: string, extraHeaders?: HeadersInit): Response {
  return json({ error: { code, message } }, { status, headers: extraHeaders })
}

export async function readJson<T = unknown>(request: Request, maxBytes = 1_500_000): Promise<T> {
  const len = Number(request.headers.get('content-length') ?? '0')
  if (len > maxBytes) throw new HttpError(413, 'tooLarge', '요청이 너무 큽니다.')
  const text = await request.text()
  if (text.length > maxBytes) throw new HttpError(413, 'tooLarge', '요청이 너무 큽니다.')
  try {
    return JSON.parse(text) as T
  } catch {
    throw new HttpError(400, 'badJson', '요청 본문을 읽을 수 없습니다.')
  }
}

/** 간단한 메모리 토큰 버킷 — isolate 단위의 최선 노력 제한. 권위 있는 제한은 Durable Object에서 수행한다. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>()
  constructor(private capacity: number, private refillPerSec: number) {}
  take(key: string): boolean {
    const now = Date.now()
    let b = this.buckets.get(key)
    if (!b) {
      b = { tokens: this.capacity, updated: now }
      this.buckets.set(key, b)
    }
    const elapsed = (now - b.updated) / 1000
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec)
    b.updated = now
    if (b.tokens < 1) return false
    b.tokens -= 1
    if (this.buckets.size > 5000) {
      for (const [k, v] of this.buckets) if (now - v.updated > 120_000) this.buckets.delete(k)
    }
    return true
  }
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
}

/** 같은 출처에서 온 요청인지 확인 (상태 변경 요청과 WebSocket에 적용) */
export function isSameOrigin(request: Request): boolean {
  const url = new URL(request.url)
  const origin = request.headers.get('origin')
  if (origin) {
    try {
      return new URL(origin).host === url.host
    } catch {
      return false
    }
  }
  const site = request.headers.get('sec-fetch-site')
  if (site) return site === 'same-origin' || site === 'none'
  // Origin/Sec-Fetch-Site 둘 다 없는 비브라우저 클라이언트는 거부하지 않는다 (쿠키가 없으면 어차피 권한이 없다)
  return true
}
