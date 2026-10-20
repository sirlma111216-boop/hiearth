import { Component, useCallback, useState, type ReactNode } from 'react'
import type { GuessKind, Evidence, ViewState, MapMode } from '@shared/domain/types'
import { LESSON_STEPS, LESSON_SCREENS, screenAt, screenLE, nextScreen, prevScreen, screenStage, type ScreenRef } from '@shared/domain/lesson'
import type { LessonData } from '../data/lesson'
import type { Action, InquiryState } from '../inquiry/engine'
import { draftMatchesRevision } from '../inquiry/engine'
import { Button } from '../ui/Button'
import type { RoomContext } from '../workspace/Workspace'
import { ActivityFrame } from './ActivityFrame'
import { ACTIVITY_TASKS, renderScreen } from './screens'

class ScreenBoundary extends Component<{ screenKey: string; children: ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  componentDidUpdate(prev: { screenKey: string }) { if (prev.screenKey !== this.props.screenKey && this.state.error) this.setState({ error: false }) }
  render() { return this.state.error ? <div className="screen-card">화면을 불러오지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.</div> : this.props.children }
}
export interface LessonShellProps {
  role: 'solo' | 'student' | 'teacher'
  data: LessonData
  state: InquiryState
  dispatch: (a: Action) => void
  screen: ScreenRef
  onScreen: (ref: ScreenRef) => void
  maxScreen?: ScreenRef
  following?: boolean
  onFollow?: (v: boolean) => void
  room?: RoomContext
  onSubmit: (kind: GuessKind) => void
  onEvidenceChange?: (list: Evidence[]) => void
  onExplanation: (text: string, limitations: string) => void | Promise<void>
  onResponses?: (responses: NonNullable<InquiryState['record']['responses']>) => void
  onShareView?: (view: ViewState, mode: MapMode, force: boolean) => void
  presentation?: boolean
  onPresentation?: (v: boolean) => void
  reportHref?: string
  nickname?: string
  startRegion?: string
}
export function LessonShell(p: LessonShellProps) {
  const [explanationDirty, setExplanationDirty] = useState(false)
  const { screen, role, state } = p
  const def = screenAt(screen.step, screen.sub) ?? LESSON_SCREENS[0]
  const next = nextScreen(screen), prev = prevScreen(screen)
  const go = useCallback((ref: ScreenRef | null) => {
    if (!ref || (role === 'student' && p.maxScreen && !screenLE(ref, p.maxScreen))) return
    p.onScreen(ref)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [role, p])
  const submitted = def.stage === 'firstGuess' ? !!state.record.firstGuess : def.stage === 'revise' ? draftMatchesRevision(state.draft, state.record.revisedGuess) : true
  const canContinue = role === 'teacher' || submitted
  const reviewing = role === 'student' && p.maxScreen && (screen.step !== p.maxScreen.step || screen.sub !== p.maxScreen.sub)
  const task = ACTIVITY_TASKS[def.id]
  const body = task ? <ActivityFrame task={task} role={role}
    notice={def.stage === 'revise' && !state.record.firstGuess && role !== 'teacher' ? <p className="callout">처음 제출한 선이 없습니다. 지진과 화산을 살펴보고 지금 생각을 선으로 남겨 주세요.</p> : undefined}
    workspace={{ data: p.data, state, dispatch: p.dispatch, role, room: p.room, onSubmit: p.onSubmit, onStage: () => {}, onEvidenceChange: p.onEvidenceChange, onExplanation: p.onExplanation, onShareView: p.onShareView, presentation: p.presentation, onPresentation: p.onPresentation, startRegion: p.startRegion, stageOverride: screenStage(screen) }} />
    : renderScreen(def.id, { data: p.data, record: state.record, role, onExplanation: p.onExplanation, reportHref: p.reportHref, locked: !!p.room?.meta.inputLocked, onDirtyChange: setExplanationDirty })
  return <div className={'lesson simple-lesson' + (p.presentation ? ' is-presenting' : '')}>
    {!p.presentation ? <nav className="stepbar" aria-label="수업 흐름">{LESSON_STEPS.map(s => <span key={s.n} className={'sb-item' + (s.n === def.section ? ' is-now' : '')} aria-current={s.n === def.section ? 'step' : undefined}>{s.short}</span>)}</nav> : null}
    <main className={'lesson-main' + (task ? ' is-activity' : '')}>
      <div className="screen-head"><h1>{def.title}</h1>{role === 'teacher' && task && p.onPresentation ? <Button size="sm" variant="quiet" onClick={() => p.onPresentation?.(!p.presentation)}>{p.presentation ? '발표 닫기' : '전체화면 발표'}</Button> : null}</div>
      <ScreenBoundary screenKey={def.id}>{body}</ScreenBoundary>
    </main>
    {!p.presentation ? <nav className="lesson-nav" aria-label="활동 이동">
      {prev ? <Button variant="quiet" onClick={() => go(prev)}>이전 활동</Button> : null}
      <span className="readout" role="status">{role === 'student' ? reviewing ? '이전 활동을 보고 있어요.' : (def.stage === 'wrapUp' ? '탐구 카드를 확인해 주세요.' : '다음 활동은 선생님이 열어 줍니다.') : def.title}</span>
      {reviewing ? <Button variant="primary" onClick={() => { p.onFollow?.(true); go(p.maxScreen!) }}>현재 수업으로 돌아가기</Button> : null}
      {role !== 'student' && next && canContinue ? <Button variant="primary" disabledReason={role === 'solo' && def.stage === 'explain' && (explanationDirty || !state.record.explanation?.text.trim()) ? '설명을 작성하고 저장해 주세요.' : undefined} onClick={() => go(next)}>{role === 'teacher' && def.stage === 'firstGuess' ? '화산 자료 보여주기' : role === 'teacher' && def.stage === 'revise' ? '판 경계 보여주기' : def.nextLabel}</Button> : null}
    </nav> : null}
  </div>
}
