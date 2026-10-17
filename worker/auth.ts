// 세션 토큰 생성·해시·쿠키 처리. 토큰 원문은 쿠키에만 있고 저장소에는 해시만 둔다.

const enc = new TextEncoder()

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

export function base64url(buf: Uint8Array): string {
  let s = ''
  for (const b of buf) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** 상수 시간 비교 (길이가 다르면 false) */
export function safeEqual(a: string, b: string): boolean {
  const A = enc.encode(a), B = enc.encode(b)
  if (A.length !== B.length) return false
  let diff = 0
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i]
  return diff === 0
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

export const teacherCookieName = (code: string) => `eet_${code}`
export const participantCookieName = (code: string) => `eep_${code}`

export function cookieHeader(name: string, value: string, opts: { maxAgeSec: number; secure: boolean }): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`]
  if (opts.secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearCookieHeader(name: string, secure: boolean): string {
  return cookieHeader(name, '', { maxAgeSec: 0, secure })
}

/** 입장 코드: 혼동되는 글자(0/O, 1/I/L)를 제외한 6자 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function randomRoomCode(): string {
  const buf = new Uint8Array(6)
  crypto.getRandomValues(buf)
  let s = ''
  for (const b of buf) s += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return s
}
export const isValidRoomCode = (s: string) => /^[A-Z0-9]{6}$/.test(s)
export const normalizeRoomCode = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
