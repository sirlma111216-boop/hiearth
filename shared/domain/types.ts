// 공통 도메인 모델 — 프런트엔드와 Worker가 함께 사용한다.
// 좌표는 항상 [경도(lng), 위도(lat)] 순서다.

export type LngLat = [number, number]

export interface Earthquake {
  id: string
  /** 발생 시각, UTC 밀리초 */
  time: number
  lon: number
  lat: number
  /** null = 원자료에 규모가 없음 (0으로 치환하지 않는다) */
  mag: number | null
  /** km, null = 원자료에 깊이가 없음 */
  depth: number | null
  place: string | null
  url: string | null
}

export interface Volcano {
  number: number
  name: string | null
  lon: number
  lat: number
  country: string | null
  region: string | null
  type: string | null
  lastEruptionYear: number | null
  elevation: number | null
}

export interface PlateFeature {
  id: number | string
  name: string | null
  label: string | null
  /** 각 선은 [lng, lat] 배열 */
  lines: LngLat[][]
}

export type DataKind = 'observation' | 'catalog' | 'model' | 'basemap'

export interface DatasetInfo {
  id: string
  kind: DataKind
  provider: string
  sourceUrl: string
  retrievedAt: string
  coverageStart: string | null
  coverageEnd: string | null
  filters: Record<string, unknown>
  datasetVersion: string
  recordCount: number
  expectedCount?: number | null
  license: string
  note?: string
  rejected?: Record<string, number>
}

// ---- 활동 단계 ----
export const STAGES = [
  'observe',
  'firstGuess',
  'firstReveal',
  'volcanoReveal',
  'revise',
  'boundaryCompare',
  'explain',
  'wrapUp',
] as const
export type Stage = (typeof STAGES)[number]

export type DrawMode = 'freehand' | 'polyline'

export interface GuessLine {
  id: string
  points: LngLat[]
  mode: DrawMode
  /** 단순화 전 원본 점 개수 (단순화 여부를 구분하기 위해 기록) */
  rawPointCount: number
}

export interface Guess {
  lines: GuessLine[]
}

export type GuessKind = 'first' | 'revised'

export interface GuessRevision {
  kind: GuessKind
  guess: Guess
  submittedAt: number
  idempotencyKey: string
  datasetVersion: string
}

export type MapMode = '2d' | '3d'

export interface ViewState {
  center: LngLat
  /** 1 = 전 지구가 화면에 들어오는 배율 */
  zoom: number
}

export type LayerId = 'earthquakes' | 'volcanoes' | 'plates' | 'myFirst' | 'myRevised' | 'others'

export interface Evidence {
  id: string
  createdAt: number
  title: string
  note: string
  view: ViewState
  mapMode: MapMode
  timeWindow: { start: number; end: number } | null
  minMagnitude: number
  layers: LayerId[]
  selectedEventIds: string[]
  datasetVersion: string
  /** PNG data URL, 캡처 실패 시 null */
  capture: string | null
}

export interface Explanation {
  text: string
  limitations: string
  updatedAt: number
}

/** 화면별 학생 응답(관찰 메모·자기 분석 선택). key = 화면 id */
export interface ScreenResponse {
  text?: string
  choices?: string[]
  updatedAt: number
}

export interface StageHistoryEntry {
  stage: Stage
  at: number
}

/** 한 사람의 탐구 기록 — 혼자 탐사와 탐사실이 같은 형식을 쓴다 */
export interface InquiryRecord {
  version: 1
  stage: Stage
  firstGuess: GuessRevision | null
  revisedGuess: GuessRevision | null
  evidence: Evidence[]
  explanation: Explanation | null
  history: StageHistoryEntry[]
  datasetVersion: string
  /** 화면별 응답 (없으면 빈 객체로 취급) */
  responses?: Record<string, ScreenResponse>
}

export const MAX_EVIDENCE = 3
export const MAX_LINES = 64
export const MAX_POINTS_PER_LINE = 400
export const MAX_NICKNAME = 12
export const MAX_TEXT = 1500

// ---- 탐사실 ----
export type RoomStatus = 'open' | 'ended' | 'deleted'

export interface RegionPreset {
  id: string
  label: string
  view: ViewState
}

export interface RoomSettings {
  title: string
  datasetId: string
  startRegion: string
  maxParticipants: number
  /** 생성 후 만료까지 ms (기본 24시간) */
  ttlMs: number
  groups: string[]
}

export interface RoomMeta {
  code: string
  title: string
  datasetId: string
  startRegion: string
  maxParticipants: number
  groups: string[]
  createdAt: number
  expiresAt: number
  endedAt: number | null
  status: RoomStatus
  stage: Stage
  joinLocked: boolean
  inputLocked: boolean
  revealed: { firstGuesses: boolean; volcanoes: boolean; boundaries: boolean; nicknames: boolean }
  followView: { view: ViewState; mode: MapMode; requestedAt: number; force: boolean } | null
  /** 교사가 현재 보고 있는 수업 화면 (학생은 이 화면까지 갈 수 있다) */
  screen: { step: number; sub: number }
  activityVersion: number
  roomRevision: number
}

export interface ParticipantPublic {
  id: string
  nickname: string
  group: string | null
  joinedAt: number
  connected: boolean
  lastSeen: number
  hasFirst: boolean
  hasRevised: boolean
  evidenceCount: number
  hasExplanation: boolean
  /** 교사가 지정한 비교 강조 */
  highlighted: boolean
}

export interface SharedGuess {
  participantId: string
  nickname: string | null
  group: string | null
  kind: GuessKind
  guess: Guess
  submittedAt: number
}

export interface ParticipantRecord {
  participant: ParticipantPublic
  record: InquiryRecord
}
