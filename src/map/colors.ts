// 지도 색상 — 용도가 겹치지 않게 정한다. 색만으로 구별하지 않고 모양(원/삼각형/선 종류)도 다르게 한다.
import type { RenderGuess } from './types'
export const MAP_COLORS = {
  ocean: '#0b2238',
  oceanDeep: '#081a2c',
  land: '#2f4b50',
  landEdge: '#587a7e',
  graticule: 'rgba(168, 188, 196, 0.10)',
  quake: '#f2c57c',
  quakeNullMag: 'rgba(242, 197, 124, 0.55)',
  volcano: '#f08e85',
  plate: '#ff496c',
  first: '#ffffff',
  revised: '#55cfff',
  others: 'rgba(168, 188, 196, 0.5)',
  highlightA: '#ffffff',
  highlightB: '#d2af75',
  draft: '#8ce8d6',
  selection: '#f3f0e7',
} as const

export const PLATE_STYLE = { width: 5, haloWidth: 10, haloOpacity: 0.24 } as const

export const GUESS_STYLES = {
  first: { color: MAP_COLORS.first, width: 2.6, dash: [] as number[] },
  revised: { color: MAP_COLORS.revised, width: 2.6, dash: [8, 5] },
  others: { color: MAP_COLORS.others, width: 1.6, dash: [] as number[] },
  highlightA: { color: MAP_COLORS.highlightA, width: 3.4, dash: [] as number[] },
  highlightB: { color: MAP_COLORS.highlightB, width: 3.4, dash: [10, 6] },
  draft: { color: MAP_COLORS.draft, width: 2.4, dash: [4, 4] },
} as const

export function guessStyle(guess: RenderGuess) {
  const style = GUESS_STYLES[guess.style]
  if (guess.style === 'draft' || (guess.layer !== 'myFirst' && guess.layer !== 'myRevised')) return style
  const base = GUESS_STYLES[guess.layer === 'myFirst' ? 'first' : 'revised']
  return { ...base, width: guess.style === 'highlightA' || guess.style === 'highlightB' ? style.width : base.width }
}

/** 규모 → 점 반지름(px, 배율 1 기준). null 규모는 작은 속 빈 원 */
export function quakeRadius(mag: number | null, zoom: number): number {
  const z = Math.pow(Math.max(1, zoom), 0.25)
  if (mag == null) return 2.2 * z
  return Math.max(1.8, 1.4 + (mag - 4.5) * 1.5) * z
}
