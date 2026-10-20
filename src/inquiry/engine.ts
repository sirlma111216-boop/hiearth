// 탐구 엔진 — 혼자 탐사와 탐사실이 같은 상태 전이를 쓴다.
// 그리기 초안(draft)과 제출된 리비전(record)을 분리한다. 최초 추론은 제출 후 바뀌지 않는다.
import type { Evidence, Guess, GuessLine, GuessRevision, InquiryRecord, LngLat, Stage, DrawMode } from '@shared/domain/types'
import { MAX_EVIDENCE, MAX_LINES, MAX_POINTS_PER_LINE } from '@shared/domain/types'
import { moveStage } from '@shared/domain/activity'
import { simplify } from '@shared/geo/sphere'
import { idempotencyKey, newId } from './ids'

export interface DraftState {
  lines: GuessLine[]
  /** 진행 중인 폴리라인 꼭짓점 */
  pending: LngLat[]
  cursor: LngLat | null
  mode: DrawMode
  undo: GuessLine[][]
  redo: GuessLine[][]
  selectedLineId: string | null
}

export type SubmitStatus = 'idle' | 'pending' | 'queued' | 'saved' | 'error'

export interface InquiryState {
  record: InquiryRecord
  draft: DraftState
  /** 제출 처리 상태 (서버 확인 전에는 '제출 완료'로 표시하지 않는다) */
  submit: { kind: 'first' | 'revised' | null; status: SubmitStatus; message: string | null }
}

export const emptyDraft = (mode: DrawMode = 'freehand'): DraftState => ({ lines: [], pending: [], cursor: null, mode, undo: [], redo: [], selectedLineId: null })

export type Action =
  | { type: 'setStage'; stage: Stage }
  | { type: 'draft/setMode'; mode: DrawMode }
  | { type: 'draft/stroke'; points: LngLat[]; zoom: number }
  | { type: 'draft/addPoint'; point: LngLat }
  | { type: 'draft/finishPending' }
  | { type: 'draft/undoPoint' }
  | { type: 'draft/cursor'; point: LngLat | null }
  | { type: 'draft/undo' }
  | { type: 'draft/redo' }
  | { type: 'draft/select'; lineId: string | null }
  | { type: 'draft/deleteSelected' }
  | { type: 'draft/clear' }
  | { type: 'draft/loadFrom'; guess: Guess }
  | { type: 'submit/start'; kind: 'first' | 'revised' }
  | { type: 'submit/queued'; kind: 'first' | 'revised' }
  | { type: 'submit/saved'; revision: GuessRevision }
  | { type: 'submit/error'; message: string }
  | { type: 'submit/reset' }
  | { type: 'evidence/add'; evidence: Evidence }
  | { type: 'evidence/update'; id: string; patch: Partial<Pick<Evidence, 'title' | 'note'>> }
  | { type: 'evidence/remove'; id: string }
  | { type: 'explanation/set'; text: string; limitations: string }
  | { type: 'record/replace'; record: InquiryRecord }
  | { type: 'responses/set'; id: string; patch: { text?: string; choices?: string[] } }

function pushUndo(d: DraftState): DraftState {
  return { ...d, undo: [...d.undo.slice(-30), d.lines], redo: [] }
}

export function reducer(state: InquiryState, a: Action): InquiryState {
  const { record, draft } = state
  switch (a.type) {
    case 'setStage':
      return { ...state, record: moveStage(record, a.stage) }
    case 'draft/setMode':
      return { ...state, draft: { ...draft, mode: a.mode, pending: [], cursor: null } }
    case 'draft/stroke': {
      if (a.points.length < 2 || draft.lines.length >= MAX_LINES) return state
      const tol = 0.35 / Math.max(1, a.zoom)
      let pts = simplify(a.points, tol)
      if (pts.length > MAX_POINTS_PER_LINE) pts = simplify(a.points, tol * 3).slice(0, MAX_POINTS_PER_LINE)
      if (pts.length < 2) return state
      const line: GuessLine = { id: newId('ln'), points: pts, mode: 'freehand', rawPointCount: a.points.length }
      const d = pushUndo(draft)
      return { ...state, draft: { ...d, lines: [...d.lines, line], selectedLineId: line.id } }
    }
    case 'draft/addPoint': {
      if (draft.pending.length >= MAX_POINTS_PER_LINE) return state
      return { ...state, draft: { ...draft, pending: [...draft.pending, a.point] } }
    }
    case 'draft/finishPending': {
      if (draft.pending.length < 2) return { ...state, draft: { ...draft, pending: [], cursor: null } }
      if (draft.lines.length >= MAX_LINES) return { ...state, draft: { ...draft, pending: [] } }
      const line: GuessLine = { id: newId('ln'), points: draft.pending, mode: 'polyline', rawPointCount: draft.pending.length }
      const d = pushUndo(draft)
      return { ...state, draft: { ...d, lines: [...d.lines, line], pending: [], cursor: null, selectedLineId: line.id } }
    }
    case 'draft/undoPoint':
      if (draft.pending.length) return { ...state, draft: { ...draft, pending: draft.pending.slice(0, -1) } }
      return reducer(state, { type: 'draft/undo' })
    case 'draft/cursor':
      return { ...state, draft: { ...draft, cursor: a.point } }
    case 'draft/undo': {
      if (!draft.undo.length) return state
      const prev = draft.undo[draft.undo.length - 1]
      return { ...state, draft: { ...draft, lines: prev, undo: draft.undo.slice(0, -1), redo: [draft.lines, ...draft.redo].slice(0, 30), selectedLineId: null } }
    }
    case 'draft/redo': {
      if (!draft.redo.length) return state
      const next = draft.redo[0]
      return { ...state, draft: { ...draft, lines: next, undo: [...draft.undo, draft.lines], redo: draft.redo.slice(1), selectedLineId: null } }
    }
    case 'draft/select':
      return { ...state, draft: { ...draft, selectedLineId: a.lineId } }
    case 'draft/deleteSelected': {
      if (!draft.selectedLineId) return state
      const d = pushUndo(draft)
      return { ...state, draft: { ...d, lines: d.lines.filter((l) => l.id !== draft.selectedLineId), selectedLineId: null } }
    }
    case 'draft/clear': {
      if (!draft.lines.length && !draft.pending.length) return state
      const d = pushUndo(draft)
      return { ...state, draft: { ...d, lines: [], pending: [], cursor: null, selectedLineId: null } }
    }
    case 'draft/loadFrom': {
      const d = pushUndo(draft)
      const lines = a.guess.lines.map((l) => ({ ...l, id: newId('ln'), points: l.points.map((p) => [p[0], p[1]] as LngLat) }))
      return { ...state, draft: { ...d, lines, pending: [], selectedLineId: null } }
    }
    case 'submit/start':
      return { ...state, submit: { kind: a.kind, status: 'pending', message: '전송 중…' } }
    case 'submit/queued':
      return { ...state, submit: { kind: a.kind, status: 'queued', message: '연결이 끊겨 전송 대기 중입니다. 다시 연결되면 자동으로 보냅니다.' } }
    case 'submit/saved': {
      const rec = a.revision.kind === 'first'
        ? (record.firstGuess ? record : { ...record, firstGuess: a.revision })
        : { ...record, revisedGuess: a.revision }
      return { ...state, record: rec, submit: { kind: a.revision.kind, status: 'saved', message: '저장되었습니다.' } }
    }
    case 'submit/error':
      return { ...state, submit: { ...state.submit, status: 'error', message: a.message } }
    case 'submit/reset':
      return { ...state, submit: { kind: null, status: 'idle', message: null } }
    case 'evidence/add': {
      if (record.evidence.length >= MAX_EVIDENCE) return state
      return { ...state, record: { ...record, evidence: [...record.evidence, a.evidence] } }
    }
    case 'evidence/update':
      return { ...state, record: { ...record, evidence: record.evidence.map((e) => (e.id === a.id ? { ...e, ...a.patch } : e)) } }
    case 'evidence/remove':
      return { ...state, record: { ...record, evidence: record.evidence.filter((e) => e.id !== a.id) } }
    case 'explanation/set':
      return { ...state, record: { ...record, explanation: { text: a.text, limitations: a.limitations, updatedAt: Date.now() } } }
    case 'record/replace':
      return { ...state, record: a.record }
    case 'responses/set': {
      const prev = record.responses ?? {}
      const cur = prev[a.id] ?? { updatedAt: 0 }
      return { ...state, record: { ...record, responses: { ...prev, [a.id]: { ...cur, ...a.patch, updatedAt: Date.now() } } } }
    }
  }
}

export function makeRevision(kind: 'first' | 'revised', draft: DraftState, datasetVersion: string): GuessRevision {
  return {
    kind,
    guess: { lines: draft.lines.map((l) => ({ ...l, points: l.points.map((p) => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4] as LngLat) })) },
    submittedAt: Date.now(),
    idempotencyKey: idempotencyKey(),
    datasetVersion,
  }
}
