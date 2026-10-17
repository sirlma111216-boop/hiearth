import type { Earthquake, Volcano, PlateFeature, LngLat, ViewState, LayerId, DrawMode, MapMode } from '@shared/domain/types'
import type { Feature, MultiPolygon, Polygon } from 'geojson'

export type LandFeature = Feature<MultiPolygon | Polygon>

export interface LandData {
  low: LandFeature
  high: LandFeature
}

export type GuessStyle = 'first' | 'revised' | 'others' | 'highlightA' | 'highlightB' | 'draft'

export interface RenderGuess {
  id: string
  style: GuessStyle
  lines: LngLat[][]
  label?: string
}

export interface MapScene {
  /** 시간순 정렬된 지진 목록 */
  earthquakes: Earthquake[]
  volcanoes: Volcano[]
  plates: PlateFeature[]
  land: LandData | null
  layers: Record<LayerId, boolean>
  /** 표시할 시간 범위 (ms). null = 전체 */
  timeRange: { min: number; max: number } | null
  minMagnitude: number
  guesses: RenderGuess[]
  /** 그리는 중인 선: 완료된 꼭짓점 + 포인터를 따라가는 임시 점 */
  draft: { points: LngLat[]; mode: DrawMode; cursor: LngLat | null } | null
  selected: { kind: 'earthquake' | 'volcano'; id: string } | null
  /** 발표용: 많은 선을 저채도로 */
  overlapEmphasis: boolean
}

export type Pick = { kind: 'earthquake' | 'volcano'; id: string } | null

export interface MapEvents {
  onViewChange?: (view: ViewState) => void
  onPick?: (pick: Pick) => void
  /** 폴리라인 모드: 클릭으로 꼭짓점 추가 */
  onDrawPoint?: (p: LngLat) => void
  /** 자유 곡선: 진행 중 */
  onDrawProgress?: (points: LngLat[]) => void
  /** 자유 곡선: 완료 */
  onDrawStroke?: (points: LngLat[]) => void
  onDrawCursor?: (p: LngLat | null) => void
  /** 키보드 Enter/Backspace/Escape */
  onDrawKey?: (key: 'add' | 'undo' | 'finish') => void
  onContextLost?: () => void
  onInteract?: () => void
}

export interface Interaction {
  mode: 'move' | 'draw'
  drawMode: DrawMode
}

export interface MapRenderer {
  readonly kind: MapMode
  mount(container: HTMLElement): void
  unmount(): void
  setScene(scene: MapScene): void
  setView(view: ViewState, animate?: boolean): void
  getView(): ViewState
  setInteraction(i: Interaction): void
  resize(): void
  /** PNG data URL (실패 시 null) */
  capture(maxWidth?: number): Promise<string | null>
  setEvents(e: MapEvents): void
  focus(): void
  /** 화면 중심 좌표 (키보드 입력용) */
  centerLngLat(): LngLat
}

export const ALL_LAYERS: Record<LayerId, boolean> = { earthquakes: true, volcanoes: false, plates: false, myFirst: true, myRevised: true, others: true }
