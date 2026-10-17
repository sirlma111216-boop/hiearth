// 최근 자료 — USGS 요약 피드를 Worker 프록시(캐시)로 받는다. '실시간'은 즉각 경보가 아니다.
import type { Earthquake } from '@shared/domain/types'
import { normalizeUsgsGeoJson } from '@shared/geo/normalize'

export type RecentFeedId = '4.5_month' | '4.5_week' | '2.5_week' | '2.5_day'

export const RECENT_FEEDS: { id: RecentFeedId; label: string; minMag: number }[] = [
  { id: '4.5_month', label: '최근 30일 · 규모 4.5 이상', minMag: 4.5 },
  { id: '4.5_week', label: '최근 7일 · 규모 4.5 이상', minMag: 4.5 },
  { id: '2.5_week', label: '최근 7일 · 규모 2.5 이상', minMag: 2.5 },
  { id: '2.5_day', label: '최근 24시간 · 규모 2.5 이상', minMag: 2.5 },
]

export interface RecentData {
  feed: RecentFeedId
  earthquakes: Earthquake[]
  /** USGS가 피드를 생성한 시각 */
  generatedAt: number | null
  /** 서버가 USGS에서 받아온 시각 */
  fetchedAt: string | null
  /** 이 브라우저가 받은 시각 */
  receivedAt: number
  source: 'cache' | 'upstream' | 'unknown'
  rejected: Record<string, number>
  title: string | null
}

export async function loadRecent(feed: RecentFeedId): Promise<RecentData> {
  const res = await fetch(`/api/feed/recent?feed=${encodeURIComponent(feed)}`, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) {
    let msg = `최근 자료를 받지 못했습니다 (${res.status})`
    try { const j = (await res.json()) as { error?: { message?: string } }; if (j.error?.message) msg = j.error.message } catch { /* noop */ }
    throw new Error(msg)
  }
  const doc = (await res.json()) as { metadata?: { generated?: number; title?: string } }
  const norm = normalizeUsgsGeoJson(doc)
  const items = norm.items.sort((a, b) => a.time - b.time)
  return {
    feed,
    earthquakes: items,
    generatedAt: typeof doc.metadata?.generated === 'number' ? doc.metadata.generated : null,
    fetchedAt: res.headers.get('x-ee-fetched-at'),
    receivedAt: Date.now(),
    source: (res.headers.get('x-ee-source') as RecentData['source']) ?? 'unknown',
    rejected: norm.rejected,
    title: doc.metadata?.title ?? null,
  }
}
