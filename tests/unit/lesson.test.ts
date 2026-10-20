import { describe, it, expect } from 'vitest'
import { FIRST_SCREEN, LESSON_SCREENS, clampScreen, nextScreen, screenStage, screenLE, refOf } from '@shared/domain/lesson'
import { emptyRecord } from '@shared/domain/activity'
import { reducer, emptyDraft, makeRevision, draftMatchesRevision, type InquiryState } from '../../src/inquiry/engine'
describe('단순화한 수업과 기록 보존',()=>{
  it('화산을 보고 수정한 뒤에만 판 경계를 비교한다',()=>{
    const stages=[];let screen: typeof FIRST_SCREEN | null=FIRST_SCREEN
    while(screen){stages.push(screenStage(screen));screen=nextScreen(screen)}
    expect(stages).toEqual(['observe','firstGuess','revise','boundaryCompare','explain','wrapUp'])
    expect(LESSON_SCREENS).toHaveLength(6)
    expect(screenLE(refOf('plate-open'),refOf('revise-draw'))).toBe(false)
    expect(screenLE({step:99,sub:1},FIRST_SCREEN)).toBe(false)
  })
  it('이전 화면 위치를 대응 활동으로 옮긴다',()=>{
    expect(clampScreen({step:1,sub:1})).toEqual(FIRST_SCREEN)
    expect(clampScreen({step:6,sub:2})).toEqual(refOf('revise-draw'))
    expect(clampScreen({step:8,sub:2})).toEqual(refOf('explain-write'))
  })
  it('첫 초안과 수정 초안을 오가도 선을 잃거나 최초 제출을 바꾸지 않는다',()=>{
    let s: InquiryState={record:emptyRecord('test'),draft:emptyDraft(),submit:{kind:null,status:'idle',message:null}}
    s=reducer(s,{type:'draft/activate',kind:'first'})
    s=reducer(s,{type:'draft/stroke',points:[[139,35],[140,37],[141,38]],zoom:1})
    s=reducer(s,{type:'submit/saved',revision:makeRevision('first',s.draft,'test')})
    const original=JSON.stringify(s.record.firstGuess)
    s=reducer(s,{type:'draft/activate',kind:'revised'})
    expect(s.draft.lines).toEqual(s.record.firstGuess?.guess.lines)
    s=reducer(s,{type:'draft/clear'})
    s=reducer(s,{type:'draft/activate',kind:'first'})
    expect(s.draft.lines).toHaveLength(1)
    s=reducer(s,{type:'draft/activate',kind:'revised'})
    expect(s.draft.lines).toHaveLength(0)
    expect(JSON.stringify(s.record.firstGuess)).toBe(original)
    s=reducer(s,{type:'draft/activate',kind:'first'})
    s=reducer(s,{type:'submit/saved',revision:makeRevision('revised',s.draft,'test')})
    expect(draftMatchesRevision(s.draft,s.record.revisedGuess)).toBe(true)
    s=reducer(s,{type:'draft/clear'})
    expect(draftMatchesRevision(s.draft,s.record.revisedGuess)).toBe(false)
    s=reducer(s,{type:'inquiry/reset',record:emptyRecord('test')})
    s=reducer(s,{type:'draft/activate',kind:'first'})
    expect(s.draft.lines).toHaveLength(0)
    expect(s.record.firstGuess).toBeNull()
  })
})
