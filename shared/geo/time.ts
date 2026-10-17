// 시간 처리 — 저장은 UTC ms, 표시는 KST(Asia/Seoul).
export const DAY_MS = 86_400_000

/** UTC 일 단위 버킷 시작 시각 (ms). 경계는 UTC 00:00 */
export const utcDayStart = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS

/** [start, end) 범위를 UTC 일 단위로 나눠 건수를 센다. 정렬 여부와 무관. */
export function dailyCounts(times: number[], start: number, end: number): { day: number; count: number }[] {
  const s = utcDayStart(start)
  const e = utcDayStart(end - 1) + DAY_MS
  const n = Math.max(0, Math.round((e - s) / DAY_MS))
  const counts = new Uint32Array(n)
  for (const t of times) {
    if (t < s || t >= e) continue
    counts[Math.floor((t - s) / DAY_MS)]++
  }
  return Array.from(counts, (count, i) => ({ day: s + i * DAY_MS, count }))
}

/** 월 단위 버킷 (UTC) */
export function monthlyCounts(times: number[], start: number, end: number): { month: number; count: number }[] {
  const out: { month: number; count: number }[] = []
  let cur = new Date(start)
  cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1))
  while (cur.getTime() < end) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1))
    out.push({ month: cur.getTime(), count: 0 })
    cur = next
  }
  if (!out.length) return out
  const firstMonth = out[0].month
  for (const t of times) {
    if (t < firstMonth || t >= end) continue
    const d = new Date(t)
    const idx = (d.getUTCFullYear() - new Date(firstMonth).getUTCFullYear()) * 12 + (d.getUTCMonth() - new Date(firstMonth).getUTCMonth())
    if (idx >= 0 && idx < out.length) out[idx].count++
  }
  return out
}

const kstFmt = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  : null
const kstDateFmt = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
  : null

export const formatKst = (ms: number) => (kstFmt ? kstFmt.format(new Date(ms)) + ' KST' : new Date(ms).toISOString())
export const formatKstDate = (ms: number) => (kstDateFmt ? kstDateFmt.format(new Date(ms)) : new Date(ms).toISOString().slice(0, 10))
export const formatUtc = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

/** 'YYYY-MM-DD' (UTC) */
export const isoDateUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10)
