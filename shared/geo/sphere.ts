// 구면 기하 — 경위도 배열 기반 추론 선의 보간·분할·단순화.
// 모든 좌표는 [lng, lat] (도 단위).
import type { LngLat } from '../domain/types'

const D2R = Math.PI / 180
const R2D = 180 / Math.PI

export type Vec3 = [number, number, number]

/** 경위도 → 단위 구 위의 3D 벡터. x축=경도0/위도0, y축=북극, z축=경도 -90 (Three.js 오른손 좌표계 기준) */
export function lngLatToVec3([lng, lat]: LngLat, radius = 1): Vec3 {
  const phi = (90 - lat) * D2R
  const theta = (lng + 180) * D2R
  return [-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta)]
}

export function vec3ToLngLat([x, y, z]: Vec3): LngLat {
  const r = Math.hypot(x, y, z) || 1
  const lat = 90 - Math.acos(y / r) * R2D
  let lng = Math.atan2(z, -x) * R2D - 180
  lng = normalizeLng(lng)
  return [round6(lng), round6(lat)]
}

export const round6 = (v: number) => Math.round(v * 1e6) / 1e6

export function normalizeLng(lng: number): number {
  return (((lng + 180) % 360) + 360) % 360 - 180
}

/** 대원 거리 (라디안) */
export function angularDistance(a: LngLat, b: LngLat): number {
  const [l1, p1] = [a[0] * D2R, a[1] * D2R]
  const [l2, p2] = [b[0] * D2R, b[1] * D2R]
  const s = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2
  return 2 * Math.asin(Math.min(1, Math.sqrt(s)))
}

export const distanceKm = (a: LngLat, b: LngLat) => angularDistance(a, b) * 6371

/** 대원 보간 (slerp). t ∈ [0,1] */
export function interpolateGreatCircle(a: LngLat, b: LngLat, t: number): LngLat {
  const d = angularDistance(a, b)
  if (d < 1e-9) return [a[0], a[1]]
  const A = Math.sin((1 - t) * d) / Math.sin(d)
  const B = Math.sin(t * d) / Math.sin(d)
  const [l1, p1] = [a[0] * D2R, a[1] * D2R]
  const [l2, p2] = [b[0] * D2R, b[1] * D2R]
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2)
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2)
  const z = A * Math.sin(p1) + B * Math.sin(p2)
  return [round6(Math.atan2(y, x) * R2D), round6(Math.atan2(z, Math.hypot(x, y)) * R2D)]
}

/**
 * 선을 대원 보간으로 촘촘하게 만든다. 3D 지구본에서 표면에 붙게 하기 위해 사용.
 * maxStepDeg: 인접 점 사이 최대 각거리(도)
 */
export function densify(points: LngLat[], maxStepDeg = 2): LngLat[] {
  if (points.length < 2) return points.slice()
  const out: LngLat[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    const d = angularDistance(a, b) * R2D
    const n = Math.max(1, Math.ceil(d / maxStepDeg))
    for (let k = 1; k <= n; k++) out.push(k === n ? b : interpolateGreatCircle(a, b, k / n))
  }
  return out
}

/**
 * 날짜 변경선(경도 ±180)에서 선을 분할한다. 2D 지도에서 태평양을 가로지르는 긴 잘못된 선을 막는다.
 * 인접 점의 경도 차가 180도를 넘으면 반대 방향으로 짧게 이어진 것으로 보고 교차점을 넣어 나눈다.
 */
export function splitAtAntimeridian(points: LngLat[]): LngLat[][] {
  if (points.length < 2) return [points.slice()]
  const parts: LngLat[][] = []
  let cur: LngLat[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    const dl = b[0] - a[0]
    if (Math.abs(dl) > 180) {
      // a 쪽 경계와 b 쪽 경계
      const sign = dl > 0 ? -1 : 1 // a가 +쪽이면 a→+180, b→-180
      const edgeA = sign > 0 ? 180 : -180
      const edgeB = -edgeA
      const bUn = b[0] + (sign > 0 ? 360 : -360) // b를 a 쪽으로 펼친 경도
      const t = (edgeA - a[0]) / (bUn - a[0])
      const lat = a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, t))
      cur.push([edgeA, round6(lat)])
      parts.push(cur)
      cur = [[edgeB, round6(lat)], b]
    } else {
      cur.push(b)
    }
  }
  if (cur.length) parts.push(cur)
  return parts.filter((p) => p.length >= 2)
}

/** Douglas–Peucker 단순화 (경위도 평면 근사, 위도에 따른 경도 보정 포함). tolerance 단위: 도 */
export function simplify(points: LngLat[], toleranceDeg: number): LngLat[] {
  if (points.length <= 2 || toleranceDeg <= 0) return points.slice()
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    let maxD = 0, idx = -1
    for (let i = s + 1; i < e; i++) {
      const d = pointSegDist(points[i], points[s], points[e])
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > toleranceDeg && idx > 0) {
      keep[idx] = 1
      stack.push([s, idx], [idx, e])
    }
  }
  return points.filter((_, i) => keep[i] === 1)
}

function pointSegDist(p: LngLat, a: LngLat, b: LngLat): number {
  const k = Math.cos(((a[1] + b[1]) / 2) * D2R) || 1e-6
  const px = p[0] * k, py = p[1], ax = a[0] * k, ay = a[1], bx = b[0] * k, by = b[1]
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export interface BBox { west: number; south: number; east: number; north: number }

export function bboxOf(points: LngLat[]): BBox | null {
  if (!points.length) return null
  let west = 180, east = -180, south = 90, north = -90
  for (const [x, y] of points) {
    if (x < west) west = x
    if (x > east) east = x
    if (y < south) south = y
    if (y > north) north = y
  }
  return { west, south, east, north }
}

/** 두 점 집합이 같은 화면 범위에서 비교되도록 공통 bbox를 구한다 */
export function unionBBox(...boxes: (BBox | null)[]): BBox | null {
  const bs = boxes.filter((b): b is BBox => !!b)
  if (!bs.length) return null
  return {
    west: Math.min(...bs.map((b) => b.west)),
    south: Math.min(...bs.map((b) => b.south)),
    east: Math.max(...bs.map((b) => b.east)),
    north: Math.max(...bs.map((b) => b.north)),
  }
}

export function isValidLngLat(v: unknown): v is LngLat {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' &&
    Number.isFinite(v[0]) && Number.isFinite(v[1]) && v[0] >= -180 && v[0] <= 180 && v[1] >= -90 && v[1] <= 90
}
