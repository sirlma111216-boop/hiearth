// 2D 장면 그리기 — 순수 함수. 대화형 지도와 보고서용 정적 지도가 함께 쓴다.
import { geoEquirectangular, geoPath, geoGraticule } from 'd3-geo'
import type { LngLat, ViewState } from '@shared/domain/types'
import { normalizeLng } from '@shared/geo/sphere'
import { GUESS_STYLES, MAP_COLORS, quakeRadius } from './colors'
import type { MapScene } from './types'

const D2R = Math.PI / 180

export interface Projector {
  scale: number
  w: number
  h: number
  center: LngLat
  project: (lng: number, lat: number) => [number, number]
  invert: (x: number, y: number) => LngLat | null
  worldWidth: number
}

export function makeProjector(view: ViewState, w: number, h: number): Projector {
  const scale = (w / (2 * Math.PI)) * view.zoom
  const [cx, cy] = [view.center[0], view.center[1]]
  const worldWidth = 2 * Math.PI * scale
  return {
    scale, w, h, center: [cx, cy], worldWidth,
    project: (lng, lat) => [w / 2 + normalizeLng(lng - cx) * D2R * scale, h / 2 + (cy - lat) * D2R * scale],
    invert: (x, y) => {
      const lng = normalizeLng(cx + (x - w / 2) / scale / D2R)
      const lat = cy - (y - h / 2) / scale / D2R
      if (lat < -90 || lat > 90) return null
      return [lng, lat]
    },
  }
}

/** 중심 위도를 지도가 화면 밖으로 나가지 않게 제한 */
export function clampView(view: ViewState, w: number, h: number): ViewState {
  const zoom = Math.max(0.8, Math.min(48, view.zoom))
  const scale = (w / (2 * Math.PI)) * zoom
  const mapHalfH = (Math.PI / 2) * scale
  const halfH = h / 2
  let lat = view.center[1]
  if (mapHalfH <= halfH) lat = 0
  else {
    const maxLat = (mapHalfH - halfH) / scale / D2R
    lat = Math.max(-maxLat, Math.min(maxLat, lat))
  }
  return { center: [normalizeLng(view.center[0]), Math.max(-89, Math.min(89, lat))], zoom }
}

function timeBounds(scene: MapScene): [number, number] {
  const eq = scene.earthquakes
  if (!scene.timeRange) return [0, eq.length]
  return [lowerBound(eq, scene.timeRange.min), lowerBound(eq, scene.timeRange.max + 1)]
}

export function lowerBound(eq: { time: number }[], t: number): number {
  let lo = 0, hi = eq.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (eq[mid].time < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function visibleEarthquakeCount(scene: MapScene): number {
  const [lo, hi] = timeBounds(scene)
  let n = 0
  for (let i = lo; i < hi; i++) {
    const m = scene.earthquakes[i].mag
    if (m == null || m >= scene.minMagnitude) n++
  }
  return n
}

export function drawScene(ctx: CanvasRenderingContext2D, scene: MapScene, view: ViewState, w: number, h: number, dpr: number, opts: { print?: boolean } = {}) {
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const P = makeProjector(view, w, h)
  // 배경
  ctx.fillStyle = MAP_COLORS.oceanDeep
  ctx.fillRect(0, 0, w, h)
  // 지도 범위(바다) — 지도 전체 높이가 화면보다 작을 때 위아래 여백은 더 어둡게
  const top = P.project(0, 90)[1], bottom = P.project(0, -90)[1]
  ctx.fillStyle = MAP_COLORS.ocean
  ctx.fillRect(0, Math.max(0, top), w, Math.min(h, bottom) - Math.max(0, top))

  const projection = geoEquirectangular().rotate([-view.center[0], 0]).scale(P.scale).translate([w / 2, h / 2 + view.center[1] * D2R * P.scale])
  const path = geoPath(projection, ctx)

  // 격자선 (방향 참고용, 매우 옅게)
  ctx.beginPath()
  path(geoGraticule().step([30, 30])())
  ctx.strokeStyle = MAP_COLORS.graticule
  ctx.lineWidth = 1
  ctx.stroke()

  // 육지
  if (scene.land) {
    const land = view.zoom >= 2.4 ? scene.land.high : scene.land.low
    ctx.beginPath()
    path(land)
    ctx.fillStyle = MAP_COLORS.land
    ctx.fill()
    ctx.strokeStyle = MAP_COLORS.landEdge
    ctx.lineWidth = 0.8
    ctx.stroke()
  }

  // 판 경계 (연구 모형) — 한 종류의 선
  if (scene.layers.plates) {
    ctx.beginPath()
    for (const f of scene.plates) for (const line of f.lines) strokeLngLatLine(ctx, P, line)
    ctx.strokeStyle = MAP_COLORS.plate
    ctx.lineWidth = 1.8
    ctx.setLineDash([])
    ctx.globalAlpha = 0.95
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // 지진 (원)
  if (scene.layers.earthquakes) {
    const [lo, hi] = timeBounds(scene)
    const eq = scene.earthquakes
    const alpha = hi - lo > 6000 ? 0.62 : 0.82
    ctx.fillStyle = MAP_COLORS.quake
    ctx.globalAlpha = alpha
    ctx.beginPath()
    const hollow: [number, number, number][] = []
    for (let i = lo; i < hi; i++) {
      const e = eq[i]
      if (e.mag != null && e.mag < scene.minMagnitude) continue
      const [x, y] = P.project(e.lon, e.lat)
      if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue
      const r = quakeRadius(e.mag, view.zoom)
      if (e.mag == null) { hollow.push([x, y, r]); continue }
      ctx.moveTo(x + r, y)
      ctx.arc(x, y, r, 0, Math.PI * 2)
    }
    ctx.fill()
    if (hollow.length) {
      ctx.beginPath()
      for (const [x, y, r] of hollow) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2) }
      ctx.strokeStyle = MAP_COLORS.quakeNullMag
      ctx.lineWidth = 1.2
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  // 화산 (삼각형)
  if (scene.layers.volcanoes) {
    ctx.beginPath()
    const s = 4.2 * Math.pow(Math.max(1, view.zoom), 0.2)
    for (const v of scene.volcanoes) {
      const [x, y] = P.project(v.lon, v.lat)
      if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue
      ctx.moveTo(x, y - s)
      ctx.lineTo(x + s * 0.95, y + s * 0.7)
      ctx.lineTo(x - s * 0.95, y + s * 0.7)
      ctx.closePath()
    }
    ctx.fillStyle = MAP_COLORS.volcano
    ctx.globalAlpha = 0.9
    ctx.fill()
    ctx.strokeStyle = 'rgba(7,21,30,0.7)'
    ctx.lineWidth = 0.8
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // 추론 선 — 다른 사람 선 먼저, 내 선과 강조 선은 위에
  // 새로 완성하거나 선택한 선은 draft 스타일이다. 선택 상태도 마지막에 그려야 즉시 보인다.
  const order = ['others', 'first', 'revised', 'highlightA', 'highlightB', 'draft'] as const
  for (const style of order) {
    for (const g of scene.guesses) {
      if (g.style !== style) continue
      const visible = style === 'first' ? scene.layers.myFirst : style === 'revised' ? scene.layers.myRevised : style === 'others' ? scene.layers.others : true
      if (!visible) continue
      const st = GUESS_STYLES[style]
      ctx.beginPath()
      for (const line of g.lines) strokeLngLatLine(ctx, P, line)
      ctx.strokeStyle = st.color
      ctx.lineWidth = style === 'others' && scene.overlapEmphasis ? 2.2 : st.width
      ctx.setLineDash(st.dash)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalAlpha = style === 'others' && scene.overlapEmphasis ? 0.35 : 1
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      // 끝점 표시(내 선)
      if (style === 'first' || style === 'revised') {
        for (const line of g.lines) for (const idx of [0, line.length - 1]) {
          const [x, y] = P.project(line[idx][0], line[idx][1])
          ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fillStyle = st.color; ctx.fill()
        }
      }
    }
  }

  // 그리는 중인 선
  if (scene.draft) {
    const st = GUESS_STYLES.draft
    const pts = scene.draft.cursor && scene.draft.mode === 'polyline' ? [...scene.draft.points, scene.draft.cursor] : scene.draft.points
    if (pts.length >= 1) {
      ctx.beginPath()
      strokeLngLatLine(ctx, P, pts)
      ctx.strokeStyle = st.color
      ctx.lineWidth = st.width
      ctx.setLineDash(st.dash)
      ctx.lineCap = 'round'
      ctx.stroke()
      ctx.setLineDash([])
      for (const p of scene.draft.points) {
        const [x, y] = P.project(p[0], p[1])
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fillStyle = st.color; ctx.fill()
      }
    }
  }

  // 선택 표시
  if (scene.selected) {
    const pos = scene.selected.kind === 'earthquake'
      ? scene.earthquakes.find((e) => e.id === scene.selected!.id)
      : scene.volcanoes.find((v) => String(v.number) === scene.selected!.id)
    if (pos) {
      const [x, y] = P.project(pos.lon, pos.lat)
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2)
      ctx.strokeStyle = MAP_COLORS.selection; ctx.lineWidth = 2; ctx.stroke()
      ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(243,240,231,0.35)'; ctx.lineWidth = 1; ctx.stroke()
    }
  }

  if (opts.print) {
    // 인쇄용 테두리
    ctx.strokeStyle = 'rgba(243,240,231,0.3)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
  }
  ctx.restore()
}

/** 경위도 선을 현재 경로에 추가. 날짜 변경선에서 화면을 가로지르는 선은 끊는다 */
export function strokeLngLatLine(ctx: CanvasRenderingContext2D, P: Projector, line: LngLat[]) {
  let prevX = NaN
  const half = P.worldWidth / 2
  for (let i = 0; i < line.length; i++) {
    const [x, y] = P.project(line[i][0], line[i][1])
    if (i === 0 || Math.abs(x - prevX) > half) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
    prevX = x
  }
}

/** 화면 좌표에서 가장 가까운 점 찾기 (지진·화산) */
export function pickAt(scene: MapScene, view: ViewState, w: number, h: number, x: number, y: number, radiusPx = 12): { kind: 'earthquake' | 'volcano'; id: string } | null {
  const P = makeProjector(view, w, h)
  let best: { kind: 'earthquake' | 'volcano'; id: string; d: number } | null = null
  const r2 = radiusPx * radiusPx
  if (scene.layers.earthquakes) {
    const [lo, hi] = timeBounds(scene)
    for (let i = lo; i < hi; i++) {
      const e = scene.earthquakes[i]
      if (e.mag != null && e.mag < scene.minMagnitude) continue
      const [px, py] = P.project(e.lon, e.lat)
      const d = (px - x) ** 2 + (py - y) ** 2
      if (d < r2 && (!best || d < best.d)) best = { kind: 'earthquake', id: e.id, d }
    }
  }
  if (scene.layers.volcanoes) {
    for (const v of scene.volcanoes) {
      const [px, py] = P.project(v.lon, v.lat)
      const d = (px - x) ** 2 + (py - y) ** 2
      if (d < r2 && (!best || d < best.d)) best = { kind: 'volcano', id: String(v.number), d }
    }
  }
  return best ? { kind: best.kind, id: best.id } : null
}
