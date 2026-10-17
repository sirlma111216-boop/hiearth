import { describe, expect, it } from 'vitest'
import { angularDistance, densify, interpolateGreatCircle, lngLatToVec3, normalizeLng, simplify, splitAtAntimeridian, vec3ToLngLat, bboxOf, isValidLngLat } from '@shared/geo/sphere'
import { dailyCounts, monthlyCounts, utcDayStart, DAY_MS } from '@shared/geo/time'
import { normalizeCompactEarthquakes, normalizeUsgsGeoJson, normalizePlates, normalizeCompactVolcanoes } from '@shared/geo/normalize'
import type { LngLat } from '@shared/domain/types'

describe('좌표 순서와 구면 왕복', () => {
  it('[lng, lat] 순서를 유지하며 3D 왕복이 일치한다', () => {
    const samples: LngLat[] = [[0, 0], [139.7, 35.7], [-74, 40.7], [179.9, -45], [-179.9, 60], [0, 89.5], [0, -89.5]]
    for (const p of samples) {
      const back = vec3ToLngLat(lngLatToVec3(p))
      expect(Math.abs(back[0] - p[0])).toBeLessThan(1e-4)
      expect(Math.abs(back[1] - p[1])).toBeLessThan(1e-4)
    }
  })
  it('경도를 [-180, 180) 범위로 정규화한다', () => {
    expect(normalizeLng(190)).toBe(-170)
    expect(normalizeLng(-190)).toBe(170)
    expect(normalizeLng(540)).toBe(180 - 360 + 0 === -180 ? -180 : -180)
    expect(normalizeLng(45)).toBe(45)
  })
  it('유효 범위 검사', () => {
    expect(isValidLngLat([180, 90])).toBe(true)
    expect(isValidLngLat([181, 0])).toBe(false)
    expect(isValidLngLat([0, -91])).toBe(false)
    expect(isValidLngLat([NaN, 0])).toBe(false)
    expect(isValidLngLat([0, 0, 0] as unknown)).toBe(false)
  })
})

describe('대원 보간', () => {
  it('중간점은 양 끝과 같은 거리', () => {
    const a: LngLat = [0, 0], b: LngLat = [90, 0]
    const m = interpolateGreatCircle(a, b, 0.5)
    expect(Math.abs(angularDistance(a, m) - angularDistance(m, b))).toBeLessThan(1e-9)
    expect(Math.abs(m[0] - 45)).toBeLessThan(1e-6)
  })
  it('densify는 최대 간격을 지킨다', () => {
    const d = densify([[0, 0], [60, 30]], 2)
    expect(d.length).toBeGreaterThan(20)
    for (let i = 1; i < d.length; i++) expect(angularDistance(d[i - 1], d[i]) * 180 / Math.PI).toBeLessThanOrEqual(2.0001)
    expect(d[0]).toEqual([0, 0])
    expect(d[d.length - 1]).toEqual([60, 30])
  })
})

describe('날짜 변경선 분할', () => {
  it('태평양을 가로지르는 선을 ±180에서 나눈다', () => {
    const parts = splitAtAntimeridian([[170, 10], [-170, 20]])
    expect(parts).toHaveLength(2)
    expect(parts[0][parts[0].length - 1][0]).toBe(180)
    expect(parts[1][0][0]).toBe(-180)
    expect(parts[0][parts[0].length - 1][1]).toBeCloseTo(15, 5)
  })
  it('반대 방향도 처리', () => {
    const parts = splitAtAntimeridian([[-175, 0], [175, 0]])
    expect(parts).toHaveLength(2)
    expect(parts[0][1][0]).toBe(-180)
    expect(parts[1][0][0]).toBe(180)
  })
  it('가로지르지 않는 선은 그대로', () => {
    expect(splitAtAntimeridian([[10, 10], [20, 20], [30, 25]])).toHaveLength(1)
  })
})

describe('단순화', () => {
  it('직선 위의 점을 제거하되 양 끝을 보존한다', () => {
    const pts: LngLat[] = Array.from({ length: 50 }, (_, i) => [i, i * 0.5])
    const s = simplify(pts, 0.1)
    expect(s[0]).toEqual(pts[0])
    expect(s[s.length - 1]).toEqual(pts[pts.length - 1])
    expect(s.length).toBeLessThan(5)
  })
  it('중요한 굴곡을 보존한다', () => {
    const pts: LngLat[] = [[0, 0], [10, 0], [20, 10], [30, 0], [40, 0]]
    const s = simplify(pts, 1)
    expect(s).toContainEqual([20, 10])
  })
  it('bbox', () => {
    expect(bboxOf([[10, -5], [-20, 30]])).toEqual({ west: -20, south: -5, east: 10, north: 30 })
    expect(bboxOf([])).toBeNull()
  })
})

describe('시간 버킷 (UTC)', () => {
  it('일 단위 경계는 UTC 00:00', () => {
    const t = Date.UTC(2024, 0, 15, 23, 59, 59)
    expect(utcDayStart(t)).toBe(Date.UTC(2024, 0, 15))
    expect(utcDayStart(t + 1000)).toBe(Date.UTC(2024, 0, 16))
  })
  it('dailyCounts는 범위 밖을 제외하고 경계를 정확히 센다', () => {
    const start = Date.UTC(2024, 0, 1), end = Date.UTC(2024, 0, 4)
    const times = [start - 1, start, start + DAY_MS - 1, start + DAY_MS, end - 1, end]
    const c = dailyCounts(times, start, end)
    expect(c.map((x) => x.count)).toEqual([2, 1, 1])
  })
  it('monthlyCounts', () => {
    const start = Date.UTC(2024, 0, 1), end = Date.UTC(2024, 3, 1)
    const times = [Date.UTC(2024, 0, 31, 23), Date.UTC(2024, 1, 1), Date.UTC(2024, 2, 15), Date.UTC(2024, 3, 1)]
    const c = monthlyCounts(times, start, end)
    expect(c).toHaveLength(3)
    expect(c.map((x) => x.count)).toEqual([1, 1, 1])
  })
})

describe('정규화', () => {
  it('압축 지진 자료: null 규모·깊이 보존, 범위 밖·중복 제외', () => {
    const doc = { schema: 'eq-compact-v1', columns: [], rows: [
      ['a', 1700000000000, 139.5, 35.5, 5.1, 10.2, 'Japan', 'https://x'],
      ['a', 1700000000001, 139.5, 35.5, 5.1, 10.2, 'dup', null],
      ['b', 1700000000002, 200, 35.5, 5.1, 10.2, 'bad lon', null],
      ['c', 1700000000003, 10, 10, null, null, 'nulls', null],
      ['d', 'not-a-time', 10, 10, 5, 5, 'bad time', null],
      [null, 1, 10, 10, 5, 5, 'no id', null],
    ] }
    const r = normalizeCompactEarthquakes(doc)
    expect(r.items.map((e) => e.id)).toEqual(['a', 'c'])
    expect(r.items[1].mag).toBeNull()
    expect(r.items[1].depth).toBeNull()
    expect(r.rejected).toEqual({ duplicate: 1, outOfRange: 1, badTime: 1, noId: 1 })
  })
  it('USGS GeoJSON 피드', () => {
    const fc = { type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'us1', geometry: { type: 'Point', coordinates: [-120, 36, 8.5] }, properties: { mag: 4.6, time: 1700000000000, place: 'CA', url: 'u' } },
      { type: 'Feature', id: 'us2', geometry: { type: 'Point', coordinates: [-120, 95, 8.5] }, properties: { mag: 4.6, time: 1700000000000 } },
    ] }
    const r = normalizeUsgsGeoJson(fc)
    expect(r.items).toHaveLength(1)
    expect(r.items[0].depth).toBe(8.5)
    expect(r.rejected.outOfRange).toBe(1)
  })
  it('판 경계와 화산', () => {
    const p = normalizePlates({ type: 'FeatureCollection', features: [
      { type: 'Feature', id: 1, properties: { name: 'A:B', label: 'Transform Boundary' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
      { type: 'Feature', id: 2, properties: {}, geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2]]] } },
      { type: 'Feature', id: 3, properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
    ] })
    expect(p.items).toHaveLength(2)
    expect(p.items[1].lines).toHaveLength(1)
    expect(p.rejected.badGeometry).toBe(1)
    const v = normalizeCompactVolcanoes({ schema: 'volcano-compact-v1', rows: [[1, 'X', 10, 10, 'C', 'R', 'T', 2020, 100], [1, 'dup', 10, 10, null, null, null, null, null], ['x', 'bad', 0, 0]] })
    expect(v.items).toHaveLength(1)
    expect(v.rejected).toEqual({ duplicate: 1, noNumber: 1 })
  })
})
