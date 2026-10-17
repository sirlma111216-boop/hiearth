import { describe, expect, it } from 'vitest'
import { emptyRecord, moveStage, checklist, nextStage, prevStage, reached } from '@shared/domain/activity'
import { reducer, emptyDraft, makeRevision, type InquiryState } from '../../src/inquiry/engine'
import { csvCell, sanitizeNickname, guessSchema } from '@shared/domain/schemas'
import type { LngLat } from '@shared/domain/types'

const init = (): InquiryState => ({ record: emptyRecord('ds-1'), draft: emptyDraft(), submit: { kind: null, status: 'idle', message: null } })

describe('활동 단계', () => {
  it('순서와 이동', () => {
    expect(nextStage('observe')).toBe('firstGuess')
    expect(prevStage('observe')).toBeNull()
    expect(nextStage('wrapUp')).toBeNull()
    expect(reached('revise', 'volcanoReveal')).toBe(true)
    expect(reached('observe', 'firstGuess')).toBe(false)
  })
  it('되돌아가도 기록은 남고 제출은 유지된다', () => {
    let s = init()
    s = reducer(s, { type: 'draft/stroke', points: [[0, 0], [10, 10], [20, 5]], zoom: 1 })
    s = reducer(s, { type: 'submit/saved', revision: makeRevision('first', s.draft, 'ds-1') })
    s = reducer(s, { type: 'setStage', stage: 'firstReveal' })
    s = reducer(s, { type: 'setStage', stage: 'observe' })
    expect(s.record.firstGuess).not.toBeNull()
    expect(s.record.history.map((h) => h.stage)).toEqual(['observe', 'firstReveal', 'observe'])
    expect(moveStage(s.record, 'observe')).toBe(s.record)
  })
})

describe('최초 추론 불변성과 수정 리비전', () => {
  it('최초 추론은 두 번째 저장으로 덮어쓰이지 않는다', () => {
    let s = init()
    s = reducer(s, { type: 'draft/stroke', points: [[0, 0], [10, 10]], zoom: 1 })
    const first = makeRevision('first', s.draft, 'ds-1')
    s = reducer(s, { type: 'submit/saved', revision: first })
    s = reducer(s, { type: 'draft/stroke', points: [[50, 0], [60, 10]], zoom: 1 })
    const again = makeRevision('first', s.draft, 'ds-1')
    s = reducer(s, { type: 'submit/saved', revision: again })
    expect(s.record.firstGuess).toBe(first)
    const revised = makeRevision('revised', s.draft, 'ds-1')
    s = reducer(s, { type: 'submit/saved', revision: revised })
    expect(s.record.revisedGuess).toBe(revised)
    expect(s.record.firstGuess).toBe(first)
    expect(first.idempotencyKey).not.toBe(revised.idempotencyKey)
    expect(first.idempotencyKey).toHaveLength(24)
  })
  it('수정 초안은 최초 추론 복사본이며 원본과 분리된다', () => {
    let s = init()
    s = reducer(s, { type: 'draft/stroke', points: [[0, 0], [10, 10]], zoom: 1 })
    s = reducer(s, { type: 'submit/saved', revision: makeRevision('first', s.draft, 'ds-1') })
    s = reducer(s, { type: 'draft/clear' })
    s = reducer(s, { type: 'draft/loadFrom', guess: s.record.firstGuess!.guess })
    expect(s.draft.lines).toHaveLength(1)
    expect(s.draft.lines[0].id).not.toBe(s.record.firstGuess!.guess.lines[0].id)
    s.draft.lines[0].points[0][0] = 99
    expect(s.record.firstGuess!.guess.lines[0].points[0][0]).toBe(0)
  })
})

describe('그리기 초안', () => {
  it('자유 곡선은 단순화되고 원본 점 수를 기록한다', () => {
    const raw: LngLat[] = Array.from({ length: 100 }, (_, i) => [i * 0.1, 0])
    const s = reducer(init(), { type: 'draft/stroke', points: raw, zoom: 1 })
    expect(s.draft.lines[0].rawPointCount).toBe(100)
    expect(s.draft.lines[0].points.length).toBeLessThan(10)
  })
  it('폴리라인: 점 추가·되돌리기·완료', () => {
    let s = init()
    s = reducer(s, { type: 'draft/setMode', mode: 'polyline' })
    s = reducer(s, { type: 'draft/addPoint', point: [0, 0] })
    s = reducer(s, { type: 'draft/addPoint', point: [5, 5] })
    s = reducer(s, { type: 'draft/addPoint', point: [9, 9] })
    s = reducer(s, { type: 'draft/undoPoint' })
    expect(s.draft.pending).toHaveLength(2)
    s = reducer(s, { type: 'draft/finishPending' })
    expect(s.draft.lines).toHaveLength(1)
    expect(s.draft.lines[0].mode).toBe('polyline')
    s = reducer(s, { type: 'draft/undo' })
    expect(s.draft.lines).toHaveLength(0)
    s = reducer(s, { type: 'draft/redo' })
    expect(s.draft.lines).toHaveLength(1)
  })
  it('선 개수·점 개수 상한', () => {
    let s = init()
    for (let i = 0; i < 20; i++) s = reducer(s, { type: 'draft/stroke', points: [[i, 0], [i + 1, 1]], zoom: 1 })
    expect(s.draft.lines).toHaveLength(12)
    const big = guessSchema.safeParse({ lines: [{ id: 'x', points: Array.from({ length: 401 }, (_, i) => [i % 180, 0]), mode: 'freehand', rawPointCount: 401 }] })
    expect(big.success).toBe(false)
  })
})

describe('체크리스트와 보안 유틸', () => {
  it('checklist는 확인 가능한 값만', () => {
    const r = emptyRecord('x')
    expect(checklist(r)).toEqual({ hasObservationEvidence: false, consideredVolcanoes: false, revisedExplanation: false, wroteLimitations: false, wroteExplanation: false })
  })
  it('별명 정리', () => {
    expect(sanitizeNickname('  파란 고래 ')).toBe('파란 고래')
    expect(sanitizeNickname('<script>')).toBe('script')
    expect(sanitizeNickname('')).toBeNull()
    expect(sanitizeNickname('가'.repeat(13))).toBeNull()
  })
  it('CSV 수식 주입 방지', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell(null)).toBe('')
  })
})
