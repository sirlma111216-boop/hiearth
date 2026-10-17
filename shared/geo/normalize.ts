// 외부 자료 → 정규화 모델. 잘못된 자료는 제외하되 제외 사유를 기록한다.
import type { Earthquake, Volcano, PlateFeature, LngLat } from '../domain/types'
import { isValidLngLat } from './sphere'

export interface NormalizeResult<T> {
  items: T[]
  rejected: Record<string, number>
  rejectedSamples: string[]
}

function makeResult<T>(): NormalizeResult<T> {
  return { items: [], rejected: {}, rejectedSamples: [] }
}
function reject<T>(r: NormalizeResult<T>, reason: string, sample: string) {
  r.rejected[reason] = (r.rejected[reason] ?? 0) + 1
  if (r.rejectedSamples.length < 20) r.rejectedSamples.push(`${reason}: ${sample}`)
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** 압축 행 형식(eq-compact-v1) → Earthquake[] */
export function normalizeCompactEarthquakes(doc: unknown, seen = new Set<string>()): NormalizeResult<Earthquake> {
  const r = makeResult<Earthquake>()
  if (!doc || typeof doc !== 'object') { reject(r, 'badDocument', typeof doc); return r }
  const d = doc as { schema?: string; columns?: string[]; rows?: unknown[] }
  if (d.schema !== 'eq-compact-v1' || !Array.isArray(d.rows)) { reject(r, 'badSchema', String(d.schema)); return r }
  for (const row of d.rows) {
    if (!Array.isArray(row)) { reject(r, 'badRow', JSON.stringify(row).slice(0, 40)); continue }
    const [id, time, lon, lat, mag, depth, place, url] = row as unknown[]
    if (typeof id !== 'string' || !id) { reject(r, 'noId', String(id)); continue }
    if (seen.has(id)) { reject(r, 'duplicate', id); continue }
    if (typeof time !== 'number' || !Number.isFinite(time)) { reject(r, 'badTime', `${id} ${String(time)}`); continue }
    if (!isValidLngLat([lon as number, lat as number])) { reject(r, 'outOfRange', `${id} ${String(lon)},${String(lat)}`); continue }
    seen.add(id)
    r.items.push({
      id,
      time,
      lon: lon as number,
      lat: lat as number,
      mag: numOrNull(mag),
      depth: numOrNull(depth),
      place: typeof place === 'string' ? place : null,
      url: typeof url === 'string' ? url : null,
    })
  }
  return r
}

/** USGS GeoJSON 피드 → Earthquake[] (최근 자료용) */
export function normalizeUsgsGeoJson(doc: unknown, seen = new Set<string>()): NormalizeResult<Earthquake> {
  const r = makeResult<Earthquake>()
  const fc = doc as { type?: string; features?: unknown[] }
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) { reject(r, 'badDocument', String(fc?.type)); return r }
  for (const f of fc.features) {
    const feat = f as { id?: unknown; geometry?: { coordinates?: unknown[] }; properties?: Record<string, unknown> }
    const id = feat?.id
    if (typeof id !== 'string' || !id) { reject(r, 'noId', String(id)); continue }
    if (seen.has(id)) { reject(r, 'duplicate', id); continue }
    const p = feat.properties ?? {}
    const c = feat.geometry?.coordinates ?? []
    const lon = c[0], lat = c[1], depth = c[2]
    if (!isValidLngLat([lon as number, lat as number])) { reject(r, 'outOfRange', id); continue }
    const time = p.time
    if (typeof time !== 'number' || !Number.isFinite(time)) { reject(r, 'badTime', id); continue }
    seen.add(id)
    r.items.push({
      id, time, lon: lon as number, lat: lat as number,
      mag: numOrNull(p.mag), depth: numOrNull(depth),
      place: typeof p.place === 'string' ? p.place : null,
      url: typeof p.url === 'string' ? p.url : null,
    })
  }
  return r
}

export function normalizeCompactVolcanoes(doc: unknown): NormalizeResult<Volcano> {
  const r = makeResult<Volcano>()
  const d = doc as { schema?: string; rows?: unknown[] }
  if (!d || d.schema !== 'volcano-compact-v1' || !Array.isArray(d.rows)) { reject(r, 'badSchema', String(d?.schema)); return r }
  const seen = new Set<number>()
  for (const row of d.rows) {
    if (!Array.isArray(row)) { reject(r, 'badRow', ''); continue }
    const [number, name, lon, lat, country, region, type, lastEruptionYear, elevation] = row as unknown[]
    if (typeof number !== 'number') { reject(r, 'noNumber', String(number)); continue }
    if (seen.has(number)) { reject(r, 'duplicate', String(number)); continue }
    if (!isValidLngLat([lon as number, lat as number])) { reject(r, 'outOfRange', String(number)); continue }
    seen.add(number)
    r.items.push({
      number, name: typeof name === 'string' ? name : null, lon: lon as number, lat: lat as number,
      country: typeof country === 'string' ? country : null, region: typeof region === 'string' ? region : null,
      type: typeof type === 'string' ? type : null, lastEruptionYear: numOrNull(lastEruptionYear), elevation: numOrNull(elevation),
    })
  }
  return r
}

export function normalizePlates(doc: unknown): NormalizeResult<PlateFeature> {
  const r = makeResult<PlateFeature>()
  const fc = doc as { type?: string; features?: unknown[] }
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) { reject(r, 'badDocument', ''); return r }
  for (const f of fc.features) {
    const feat = f as { id?: number | string; properties?: { name?: unknown; label?: unknown }; geometry?: { type?: string; coordinates?: unknown } }
    const g = feat.geometry
    let lines: LngLat[][] = []
    if (g?.type === 'LineString') lines = [g.coordinates as LngLat[]]
    else if (g?.type === 'MultiLineString') lines = g.coordinates as LngLat[][]
    else { reject(r, 'badGeometry', String(g?.type)); continue }
    lines = lines.map((l) => l.filter(isValidLngLat)).filter((l) => l.length >= 2)
    if (!lines.length) { reject(r, 'emptyGeometry', String(feat.id)); continue }
    r.items.push({
      id: feat.id ?? r.items.length,
      name: typeof feat.properties?.name === 'string' ? feat.properties.name : null,
      label: typeof feat.properties?.label === 'string' ? feat.properties.label : null,
      lines,
    })
  }
  return r
}
