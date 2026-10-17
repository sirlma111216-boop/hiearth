// 외부 API 프록시 — 허용된 호스트·경로·매개변수만. 임의 URL은 받지 않는다.
import { errorResponse, json } from './http'

const USGS_FEEDS: Record<string, string> = {
  '4.5_month': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson',
  '4.5_week': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson',
  '2.5_week': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson',
  '2.5_day': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
}

const FEED_TTL_SEC = 600
const inflight = new Map<string, Promise<Response>>()

export async function recentFeed(request: Request, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  const feed = url.searchParams.get('feed') ?? '4.5_month'
  const upstream = USGS_FEEDS[feed]
  if (!upstream) return errorResponse(400, 'badFeed', '지원하지 않는 피드입니다.')

  const cache = (caches as unknown as { default: Cache }).default
  const cacheKey = new Request(`https://cache.local/feed/${feed}`)
  const cached = await cache.match(cacheKey)
  if (cached) return withMeta(cached, 'cache')

  // 동시 요청 병합: 교실 40명이 각각 외부 API를 호출하지 않게 한다
  let p = inflight.get(feed)
  if (!p) {
    p = fetchUpstream(upstream, feed)
    inflight.set(feed, p)
    p.finally(() => inflight.delete(feed))
  }
  const res = await p
  if (res.ok) {
    ctx.waitUntil(cache.put(cacheKey, res.clone()))
    return withMeta(res, 'upstream')
  }
  return res
}

async function fetchUpstream(upstream: string, feed: string): Promise<Response> {
  let delay = 500
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(upstream, { headers: { 'user-agent': 'earth-expedition/1.0 (classroom app)' }, signal: AbortSignal.timeout(12_000) })
      if (r.status === 429 || r.status >= 500) throw new Error(`upstream ${r.status}`)
      if (!r.ok) return errorResponse(502, 'upstreamFailed', `USGS 응답 오류 (${r.status})`)
      const body = await r.text()
      // 응답 형식을 최소 검증
      let parsed: { type?: string; metadata?: { generated?: number } }
      try {
        parsed = JSON.parse(body)
      } catch {
        return errorResponse(502, 'upstreamBadJson', 'USGS 응답을 읽을 수 없습니다.')
      }
      if (parsed.type !== 'FeatureCollection') return errorResponse(502, 'upstreamBadShape', 'USGS 응답 형식이 예상과 다릅니다.')
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': `public, max-age=${FEED_TTL_SEC}`,
          'x-ee-feed': feed,
          'x-ee-fetched-at': new Date().toISOString(),
          'x-ee-generated': String(parsed.metadata?.generated ?? ''),
        },
      })
    } catch (e) {
      if (attempt === 2) return json({ error: { code: 'upstreamUnavailable', message: `USGS 피드에 연결하지 못했습니다. (${String(e).slice(0, 80)})` } }, { status: 503, headers: { 'retry-after': '30' } })
      await new Promise((r) => setTimeout(r, delay))
      delay *= 2
    }
  }
  return errorResponse(503, 'upstreamUnavailable', 'USGS 피드에 연결하지 못했습니다.')
}

function withMeta(res: Response, source: 'cache' | 'upstream'): Response {
  const h = new Headers(res.headers)
  h.set('x-ee-source', source)
  h.set('x-ee-served-at', new Date().toISOString())
  return new Response(res.body, { status: res.status, headers: h })
}
