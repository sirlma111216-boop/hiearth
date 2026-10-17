// 보고서용 정적 지도 — 저장된 좌표·데이터로 다시 그린다 (지구본 캡처에 의존하지 않는다).
import type { Guess, LngLat, ViewState } from '@shared/domain/types'
import { bboxOf, unionBBox } from '@shared/geo/sphere'
import { drawScene } from '../map/scene2d'
import type { MapScene, RenderGuess } from '../map/types'
import { ALL_LAYERS } from '../map/types'
import type { LessonData } from '../data/lesson'

/** 두 추론이 같은 범위에서 비교되도록 공통 시점을 만든다 */
export function viewForGuesses(guesses: (Guess | null)[], w: number, h: number): ViewState {
  const pts: LngLat[] = []
  for (const g of guesses) if (g) for (const l of g.lines) pts.push(...l.points)
  const box = unionBBox(bboxOf(pts))
  if (!box) return { center: [20, 10], zoom: 1 }
  const spanLng = Math.max(20, box.east - box.west + 20)
  const spanLat = Math.max(15, box.north - box.south + 15)
  const zoomX = 360 / spanLng
  const zoomY = (180 * (w / h)) / spanLat
  const zoom = Math.max(1, Math.min(12, Math.min(zoomX, zoomY) * 0.95))
  return { center: [(box.east + box.west) / 2, (box.north + box.south) / 2], zoom }
}

export function renderStaticMap(data: LessonData, guess: Guess | null, style: 'first' | 'revised', view: ViewState, w = 640, h = 400, opts: { volcanoes?: boolean; plates?: boolean } = {}): string | null {
  try {
    const canvas = document.createElement('canvas')
    const dpr = 2
    canvas.width = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const guesses: RenderGuess[] = guess ? [{ id: style, style, lines: guess.lines.map((l) => l.points) }] : []
    const scene: MapScene = {
      earthquakes: data.earthquakes, volcanoes: data.volcanoes, plates: data.plates, land: data.land,
      layers: { ...ALL_LAYERS, volcanoes: !!opts.volcanoes, plates: !!opts.plates },
      timeRange: null, minMagnitude: 0, guesses, draft: null, selected: null, overlapEmphasis: false,
    }
    drawScene(ctx, scene, view, w, h, dpr, { print: true })
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}
