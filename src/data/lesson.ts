// 수업용 저장 자료 로더 — 분할된 정적 파일을 읽어 정규화한다.
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Earthquake, Volcano, PlateFeature, DatasetInfo } from '@shared/domain/types'
import { normalizeCompactEarthquakes, normalizeCompactVolcanoes, normalizePlates, type NormalizeResult } from '@shared/geo/normalize'
import type { LandData, LandFeature } from '../map/types'

export interface LessonManifest {
  schema: string
  generatedAt: string
  datasets: {
    earthquakesLesson: DatasetInfo & { files: { year: number; path: string; recordCount: number; apiCount: number }[]; firstEventTime: string; lastEventTime: string }
    volcanoes: DatasetInfo & { path: string }
    plateBoundaries: DatasetInfo & { path: string; labelCounts: Record<string, number> }
    land: DatasetInfo & { files: { path: string }[]; packageVersion: string }
  }
}

export interface LessonData {
  manifest: LessonManifest
  earthquakes: Earthquake[]
  volcanoes: Volcano[]
  plates: PlateFeature[]
  land: LandData
  datasetVersion: string
  timeRange: { min: number; max: number }
  rejected: { earthquakes: Record<string, number>; volcanoes: Record<string, number>; plates: Record<string, number> }
}

export type ProgressFn = (loaded: number, total: number, label: string) => void

let cache: Promise<LessonData> | null = null

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path} 불러오기 실패 (${res.status})`)
  return (await res.json()) as T
}

function mergeRejected(target: Record<string, number>, r: Record<string, number>) {
  for (const [k, v] of Object.entries(r)) target[k] = (target[k] ?? 0) + v
}

export function loadLessonData(onProgress?: ProgressFn): Promise<LessonData> {
  if (cache) return cache
  cache = (async () => {
    const manifest = await getJson<LessonManifest>('/data/manifest.json')
    const eqFiles = manifest.datasets.earthquakesLesson.files
    const total = eqFiles.length + 4
    let loaded = 0
    const tick = (label: string) => onProgress?.(++loaded, total, label)

    const seen = new Set<string>()
    const earthquakes: Earthquake[] = []
    const rejectedEq: Record<string, number> = {}
    // 연도 파일을 병렬로 받되 순서는 유지
    const docs = await Promise.all(eqFiles.map(async (f) => { const d = await getJson<unknown>('/' + f.path); tick(`${f.year}년 지진 자료`); return d }))
    for (const d of docs) {
      const r: NormalizeResult<Earthquake> = normalizeCompactEarthquakes(d, seen)
      earthquakes.push(...r.items)
      mergeRejected(rejectedEq, r.rejected)
    }
    earthquakes.sort((a, b) => a.time - b.time)

    const [volDoc, plateDoc, landLow, landHigh] = await Promise.all([
      getJson<unknown>('/' + manifest.datasets.volcanoes.path).then((d) => { tick('화산 목록'); return d }),
      getJson<unknown>('/' + manifest.datasets.plateBoundaries.path).then((d) => { tick('판 경계 모형'); return d }),
      getJson<Topology>('/data/land-110m.json').then((d) => { tick('육지 자료'); return d }),
      getJson<Topology>('/data/land-50m.json').then((d) => { tick('육지 상세 자료'); return d }),
    ])
    const vol = normalizeCompactVolcanoes(volDoc)
    const plates = normalizePlates(plateDoc)
    const land: LandData = {
      low: feature(landLow, landLow.objects.land as GeometryCollection) as unknown as LandFeature,
      high: feature(landHigh, landHigh.objects.land as GeometryCollection) as unknown as LandFeature,
    }
    const min = earthquakes[0]?.time ?? Date.parse(manifest.datasets.earthquakesLesson.coverageStart ?? '2015-01-01')
    const max = earthquakes[earthquakes.length - 1]?.time ?? Date.parse(manifest.datasets.earthquakesLesson.coverageEnd ?? '2025-01-01')
    return {
      manifest,
      earthquakes,
      volcanoes: vol.items,
      plates: plates.items,
      land,
      datasetVersion: manifest.datasets.earthquakesLesson.datasetVersion,
      timeRange: { min, max },
      rejected: { earthquakes: rejectedEq, volcanoes: vol.rejected, plates: plates.rejected },
    }
  })()
  cache.catch(() => { cache = null })
  return cache
}

/** 보고서·정적 지도용: 육지·판 경계만 가볍게 */
export async function loadBasemapOnly(): Promise<{ land: LandData; plates: PlateFeature[]; volcanoes: Volcano[]; earthquakes: Earthquake[] }> {
  const d = await loadLessonData()
  return { land: d.land, plates: d.plates, volcanoes: d.volcanoes, earthquakes: d.earthquakes }
}
