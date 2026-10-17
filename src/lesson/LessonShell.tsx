// 수업 셸 — 단계 표시줄, 화면 카드, 이전/다음. 혼자 탐사·학생·교사가 같은 셸을 쓴다.
import { Component, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { GuessKind, Evidence, ViewState, MapMode } from '@shared/domain/types'
import { LESSON_STEPS, LESSON_SCREENS, SUBS, screenAt, screenIndex, screenLE, nextScreen, prevScreen, nextStepStart, screenLabel, screenStage, type ScreenRef } from '@shared/domain/lesson'
import type { LessonData } from '../data/lesson'
import type { Action, InquiryState } from '../inquiry/engine'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import type { RoomContext } from '../workspace/Workspace'
import { ActivityFrame } from './ActivityFrame'
import { ACTIVITY_TASKS, renderScreen } from './screens'

/** 화면 하나의 오류가 수업 전체를 비우지 않게 한다 */
class ScreenBoundary extends Component<{ screenKey: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) } }
  componentDidUpdate(prev: { screenKey: string }) { if (prev.screenKey !== this.props.screenKey && this.state.error) this.setState({ error: null }) }
  render() {
    if (this.state.error) return <div className="screen-card"><h2 style={{ fontSize: 18 }}>이 화면을 그리지 못했습니다</h2><p className="muted small" style={{ marginTop: 8 }}>다음 화면으로 넘어가거나 새로고침해 보세요. 작성한 내용은 유지됩니다.</p><p className="tiny muted" style={{ marginTop: 8 }}>{this.state.error}</p></div>
    return this.props.children
  }
}

export interface LessonShellProps {
  role: 'solo' | 'student' | 'teacher'
  data: LessonData
  state: InquiryState
  dispatch: (a: Action) => void
  screen: ScreenRef
  onScreen: (ref: ScreenRef) => void
  /** 학생: 교사가 연 화면까지만 */
  maxScreen?: ScreenRef
  following?: boolean
  onFollow?: (v: boolean) => void
  room?: RoomContext
  onSubmit: (kind: GuessKind) => void
  onEvidenceChange?: (list: Evidence[]) => void
  onExplanation: (text: string, limitations: string) => void
  onResponses?: (responses: NonNullable<InquiryState['record']['responses']>) => void
  onShareView?: (view: ViewState, mode: MapMode, force: boolean) => void
  presentation?: boolean
  onPresentation?: (v: boolean) => void
  reportHref?: string
  nickname?: string
  startRegion?: string
}

export function LessonShell(p: LessonShellProps) {
  const toast = useToast()
  const { screen, role, state, dispatch } = p
  const def = screenAt(screen.step, screen.sub) ?? LESSON_SCREENS[0]
  const stepDef = LESSON_STEPS.find((s) => s.n === def.step)!
  const record = state.record
  const responses = record.responses ?? {}

  const allowed = useCallback((ref: ScreenRef) => (role === 'student' && p.maxScreen ? screenLE(ref, p.maxScreen) : true), [role, p.maxScreen])

  // 화면 이동 조건
  const blockReason = useMemo<string | null>(() => {
    if (def.id === 'guess-draw' && !record.firstGuess && role !== 'teacher') return '최초 추론을 제출하면 다음으로 갈 수 있습니다'
    if (def.id === 'revise-draw' && !record.revisedGuess && role !== 'teacher') return '수정 추론을 제출하면 다음으로 갈 수 있습니다 (그대로 두어도 제출하세요)'
    return null
  }, [def.id, record.firstGuess, record.revisedGuess, role])

  const go = useCallback((ref: ScreenRef | null) => {
    if (!ref) return
    if (!allowed(ref)) { toast.push('선생님이 아직 그 화면을 열지 않았습니다.'); return }
    p.onScreen(ref)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [allowed, p, toast])

  const next = nextScreen(screen)
  const prev = prevScreen(screen)
  const skip = def.skippable ? nextStepStart(screen) : null

  // 응답 저장 (디바운스 전송)
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setResponse = useCallback((patch: { text?: string; choices?: string[] }) => {
    dispatch({ type: 'responses/set', id: def.id, patch })
    if (!p.onResponses) return
    if (sendTimer.current) clearTimeout(sendTimer.current)
    const snapshot = { ...(record.responses ?? {}), [def.id]: { ...(record.responses?.[def.id] ?? { updatedAt: 0 }), ...patch, updatedAt: Date.now() } }
    sendTimer.current = setTimeout(() => p.onResponses?.(snapshot), 900)
  }, [def.id, dispatch, p, record.responses])

  // 단계 표시줄에서 현재 항목이 보이도록
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => { barRef.current?.querySelector<HTMLElement>('.sb-item.is-now')?.scrollIntoView({ block: 'nearest', inline: 'center' }) }, [screen.step])

  const ctx = {
    data: p.data, record, role, classroom: !!p.room, response: responses[def.id], setResponse, onExplanation: p.onExplanation,
    goNext: () => go(next), reportHref: p.reportHref, nickname: p.nickname,
  }

  const task = ACTIVITY_TASKS[def.id]
  const done = useMemo<boolean[]>(() => {
    switch (def.id) {
      case 'observe-close': return [true, record.evidence.length > 0]
      case 'guess-draw': return [true, state.draft.lines.length > 0 || !!record.firstGuess, !!record.firstGuess]
      case 'volcano-compare': return [record.evidence.length > 1, false]
      case 'revise-draw': return [true, !!record.revisedGuess]
      default: return []
    }
  }, [def.id, record.evidence.length, record.firstGuess, record.revisedGuess, state.draft.lines.length])

  const body = def.kind === 'activity' && task ? (
    <ActivityFrame task={task} done={done} role={role} response={responses[def.id]} onResponse={setResponse}
      workspace={{
        data: p.data, state, dispatch, role, room: p.room, onSubmit: p.onSubmit,
        onStage: () => { /* 단계는 화면이 정한다 */ }, onEvidenceChange: p.onEvidenceChange, onExplanation: p.onExplanation,
        onShareView: p.onShareView, presentation: p.presentation, onPresentation: p.onPresentation, startRegion: p.startRegion, reportHref: undefined,
        stageOverride: screenStage(screen),
      }} />
  ) : renderScreen(def.id, ctx)

  const guarded = <ScreenBoundary screenKey={def.id}>{body}</ScreenBoundary>
  if (p.presentation) return <div className="lesson" style={{ paddingTop: 0 }}>{guarded}</div>

  return (
    <div className="lesson">
      <nav className="stepbar" ref={barRef} aria-label="수업 단계">
        {LESSON_STEPS.map((s, i) => {
          const cur = s.n === screen.step
          const doneStep = s.n < screen.step
          const locked = !allowed({ step: s.n, sub: 1 })
          return (
            <span key={s.n} style={{ display: 'contents' }}>
              {(i === 0 || s.first) ? <span className={'sb-split' + (i === 0 ? ' is-first' : '')} aria-hidden="true">{s.period}차시</span> : null}
              <button type="button" className={'sb-item' + (cur ? ' is-now' : doneStep ? ' is-done' : '') + (locked ? ' is-locked' : '')} onClick={() => go({ step: s.n, sub: 1 })} aria-current={cur ? 'step' : undefined} title={`${s.n}. ${s.long}`} disabled={locked}>
                <span className="sb-num">{s.n}</span><span className="sb-label">{s.short}</span>
              </button>
            </span>
          )
        })}
      </nav>

      <main className="lesson-main">
        {def.kind !== 'narrative' ? (
          <div className="screen-head">
            <div><div className="kicker">{stepDef.n}. {stepDef.long} · {def.sub}/{SUBS[def.step]}</div>{def.kind === 'activity' ? <h1>{def.title}</h1> : null}</div>
            <div className="row" style={{ gap: 6 }}>
              {role === 'student' && p.onFollow ? <Button size="sm" variant="quiet" icon="target" active={!!p.following} onClick={() => p.onFollow?.(!p.following)} aria-pressed={!!p.following}>{p.following ? '선생님 따라가는 중' : '따라가기 꺼짐'}</Button> : null}
              {role === 'teacher' && p.onPresentation && def.kind === 'activity' ? <Button size="sm" variant="secondary" icon="expand" onClick={() => p.onPresentation?.(true)}>전체화면 발표</Button> : null}
            </div>
          </div>
        ) : null}
        {guarded}
        {(SUBS[def.step] ?? 1) > 1 ? <div className="sub-dots" aria-hidden="true">{Array.from({ length: SUBS[def.step] }, (_, i) => <span key={i} className={i + 1 === def.sub ? 'is-on' : ''} />)}</div> : null}
      </main>

      <nav className="lesson-nav" aria-label="화면 이동">
        <Button variant="secondary" icon="arrowLeft" onClick={() => go(prev)} disabledReason={!prev ? '첫 화면입니다' : undefined}>이전</Button>
        <span className="readout">{screenLabel(screen)} · {screenIndex(screen) + 1}/{LESSON_SCREENS.length}</span>
        <Button variant="primary" iconRight="arrowRight" onClick={() => go(next)} disabledReason={!next ? '마지막 화면입니다' : blockReason ?? (next && !allowed(next) ? '선생님이 다음 화면을 열면 넘어갈 수 있습니다' : undefined)}>다음</Button>
        {skip && allowed(skip) ? <button type="button" className="btn btn-quiet btn-sm btn-skip" onClick={() => go(skip)}>건너뛰기 <Icon name="next" /></button> : null}
      </nav>
    </div>
  )
}
