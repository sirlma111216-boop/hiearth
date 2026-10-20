import { describe, expect, it } from 'vitest'
import { LESSON_STEPS, LESSON_SCREENS, refOf, skipExplanation } from '@shared/domain/lesson'
import { emptyRecord } from '@shared/domain/activity'
import { emptyDraft, reducer, type InquiryState } from '../../src/inquiry/engine'

describe('기존 수업 흐름의 설명 건너뛰기', () => {
  it('8단계 24화면과 모든 필수 활동을 유지한다', () => {
    expect(LESSON_STEPS).toHaveLength(8)
    expect(LESSON_SCREENS).toHaveLength(24)
    for (const [from, to] of [
      ['quake-what', 'observe-world'], ['quake-dot', 'observe-world'], ['quake-data', 'observe-world'],
      ['guess-howto', 'guess-draw'], ['volcano-what', 'volcano-open'],
      ['revise-why', 'revise-draw'], ['plate-what', 'plate-open'],
    ]) expect(skipExplanation(refOf(from))).toEqual(refOf(to))
    expect(skipExplanation(refOf('guess-draw'))).toBeNull()
  })
})

describe('설명 초안과 제출 기록 분리', () => {
  const initial = (): InquiryState => ({ record: emptyRecord('test'), draft: emptyDraft(), submit: { kind: null, status: 'idle', message: null } })
  it('화면·서버 기록이 바뀌어도 설명과 한계 초안을 보존한다', () => {
    let s = initial()
    s = reducer(s, { type: 'explanation/draft', field: 'text', value: '아직 저장하지 않은 설명' })
    s = reducer(s, { type: 'explanation/draft', field: 'limitations', value: '아직 저장하지 않은 한계' })
    s = reducer(s, { type: 'setStage', stage: 'wrapUp' })
    s = reducer(s, { type: 'record/replace', record: emptyRecord('test') })
    expect(s.explanationDraft).toEqual({ text: '아직 저장하지 않은 설명', limitations: '아직 저장하지 않은 한계' })
    expect(s.record.explanation).toBeNull()
  })
  it('설명 저장은 한계 초안과 응답 대기 중 추가한 문장을 지우지 않는다', () => {
    let s = initial()
    s = reducer(s, { type: 'explanation/draft', field: 'text', value: '추가 입력한 설명' })
    s = reducer(s, { type: 'explanation/draft', field: 'limitations', value: '한계 초안' })
    s = reducer(s, { type: 'explanation/set', text: '이전에 보낸 설명', limitations: '' })
    expect(s.explanationDraft?.text).toBe('추가 입력한 설명')
    s = reducer(s, { type: 'explanation/set', text: '추가 입력한 설명', limitations: '' })
    expect(s.explanationDraft).toEqual({ limitations: '한계 초안' })
    s = reducer(s, { type: 'explanation/draft', field: 'text', value: '' })
    expect(s.explanationDraft?.text).toBe('')
    s = reducer(s, { type: 'explanation/clearDraft' })
    expect(s.explanationDraft).toBeUndefined()
  })
})
