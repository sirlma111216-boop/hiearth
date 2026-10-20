import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { InquiryRecord } from '@shared/domain/types'
import type { LessonData } from '../data/lesson'
import { Button } from '../ui/Button'
import { renderStaticMap, viewForGuesses } from '../report/staticMap'
import type { ActivityTask } from './ActivityFrame'

export interface ScreenCtx {
  data: LessonData
  record: InquiryRecord
  role: 'solo' | 'student' | 'teacher'
  onExplanation: (text: string, limitations: string) => void | Promise<void>
  reportHref?: string
  locked?: boolean
  onDirtyChange?: (dirty: boolean) => void
}
export const ACTIVITY_TASKS: Record<string, ActivityTask> = {
  'observe-world': {
    question: '지진은 어디에 모여 있을까요?',
    hint: '지도를 움직이고 점을 눌러 살펴보세요. 점 하나는 지진 한 번입니다.',
    panels: { tools: false, time: true, evidence: true },
    initialLayers: { earthquakes: true, volcanoes: false, plates: false, others: false },
    teacherTip: '지진이 고르게 퍼져 있는지, 특정한 모양으로 모이는지 물어보세요.',
  },
  'guess-draw': {
    question: '판의 경계가 있을 것 같은 곳에 선을 그려 보세요',
    hint: '지도를 움직여 위치를 정한 뒤 선 그리기를 누르세요. 정확하게 그리지 않아도 괜찮습니다.',
    panels: { tools: true, evidence: true, time: false },
    initialLayers: { earthquakes: true, volcanoes: false, plates: false },
    teacherTip: '학생들이 선을 제출했는지 확인한 뒤 화산 자료를 보여주세요.',
  },
  'revise-draw': {
    question: '화산 자료를 보니, 내 선을 바꾸고 싶나요?',
    hint: '처음 제출한 선을 가져왔습니다. 고칠 곳만 고치세요. 그대로 제출해도 괜찮습니다.',
    panels: { tools: true, evidence: true, time: false },
    initialLayers: { earthquakes: true, volcanoes: true, plates: false, myFirst: false },
    teacherTip: '선을 바꾸지 않은 학생에게도 어떤 증거를 보고 유지했는지 물어보세요.',
  },
  'plate-open': {
    question: '연구자들의 판 경계와 내 선을 비교해 보세요',
    hint: '같은 곳과 다른 곳을 찾아보세요. 판 경계는 연구 모형이며, 선의 정확도를 채점하지 않습니다.',
    panels: { tools: false, evidence: true, time: false },
    initialLayers: { earthquakes: true, volcanoes: true, plates: true, myFirst: false, myRevised: true },
    teacherTip: '경계 밖의 지진이나 화산도 찾아보며, 모든 점이 경계에 놓이는 것은 아님을 확인하세요.',
  },
}
function MiniMap({ ctx, kind }: { ctx: ScreenCtx; kind: 'first' | 'revised' }) {
  const guess = kind === 'first' ? ctx.record.firstGuess?.guess ?? null : ctx.record.revisedGuess?.guess ?? null
  const view = useMemo(() => viewForGuesses([ctx.record.firstGuess?.guess ?? null, ctx.record.revisedGuess?.guess ?? null], 640, 400), [ctx.record.firstGuess, ctx.record.revisedGuess])
  const [img, setImg] = useState<string | null>(null)
  useEffect(() => { const t = setTimeout(() => setImg(renderStaticMap(ctx.data, guess, kind, view, 640, 400, { volcanoes: kind === 'revised', plates: kind === 'revised' })), 20); return () => clearTimeout(t) }, [ctx.data, guess, kind, view])
  const caption = kind === 'first' ? '처음 생각 · 지진 자료를 보고 그린 선' : '다시 생각한 결과 · 화산 자료를 본 뒤의 선'
  return <figure className="mini-map">{img ? <img src={img} alt={caption} /> : <div style={{ aspectRatio: '8/5' }} />}<figcaption>{caption}{!guess ? ' · 제출한 선이 없습니다' : ''}</figcaption></figure>
}
function EvidenceStrip({ ctx }: { ctx: ScreenCtx }) {
  if (!ctx.record.evidence.length) return <p className="hint">담아 둔 장면이 없어도 지도에서 관찰한 내용을 설명할 수 있습니다.</p>
  return <div className="evidence-strip">{ctx.record.evidence.map((e, i) => <figure key={e.id}>{e.capture ? <img src={e.capture} alt={`관찰 장면 ${i + 1}`} /> : null}<figcaption>{e.title || `관찰 장면 ${i + 1}`}{e.note ? ` — ${e.note}` : ''}</figcaption></figure>)}</div>
}
export function renderScreen(id: string, ctx: ScreenCtx) {
  if (id === 'explain-write') return <ExplainWrite ctx={ctx} />
  if (id === 'wrap-card') return <div className="screen-card stack">
    {ctx.role === 'teacher' ? <p>학생은 자신의 처음 선과 나중 선, 설명을 확인합니다. 교사 화면의 결과에서 학생별 기록을 볼 수 있습니다.</p> : <>
      <div className="compare-grid"><MiniMap ctx={ctx} kind="first" /><MiniMap ctx={ctx} kind="revised" /></div>
      <h2>나의 설명</h2><p className="saved-prose">{ctx.record.explanation?.text || '아직 설명을 작성하지 않았습니다.'}</p>
      <details className="simple-details"><summary>자료의 한계와 관찰 장면</summary><p>{ctx.record.explanation?.limitations || '작성한 자료의 한계가 없습니다.'}</p><EvidenceStrip ctx={ctx} /></details>
      {ctx.reportHref ? <Link to={ctx.reportHref} className="btn btn-primary">탐구 카드 열기 · 인쇄와 저장</Link> : null}
    </>}
  </div>
  return null
}
function ExplainWrite({ ctx }: { ctx: ScreenCtx }) {
  const draftKey = `ee.explanation-draft.${ctx.reportHref ?? 'showcase'}`
  const loadDraft = (): { text?: string; limits?: string } => {
    try { return JSON.parse(sessionStorage.getItem(draftKey) ?? '{}') } catch { return {} }
  }
  const [text, setText] = useState(() => loadDraft().text ?? ctx.record.explanation?.text ?? '')
  const [limits, setLimits] = useState(() => loadDraft().limits ?? ctx.record.explanation?.limitations ?? '')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const dirty = text !== (ctx.record.explanation?.text ?? '') || limits !== (ctx.record.explanation?.limitations ?? '')
  useEffect(() => {
    ctx.onDirtyChange?.(dirty)
    if (ctx.role === 'teacher') return
    try {
      if (dirty) sessionStorage.setItem(draftKey, JSON.stringify({ text, limits }))
      else sessionStorage.removeItem(draftKey)
    } catch { /* 브라우저 저장이 차단돼도 화면 안의 초안은 유지한다. */ }
  }, [text, limits, dirty, draftKey, ctx.role, ctx.onDirtyChange])
  const save = async () => {
    setBusy(true); setStatus('저장 중…')
    try { await ctx.onExplanation(text, limits); setStatus(ctx.role === 'solo' ? '이 기기에 저장했습니다.' : '선생님께 보냈어요.') }
    catch (e) { setStatus(e instanceof Error ? e.message : '저장하지 못했습니다. 다시 시도해 주세요.') }
    finally { setBusy(false) }
  }
  if (ctx.role === 'teacher') return <div className="screen-card"><p>학생은 관찰한 곳을 근거로 지진·화산과 판 경계의 관계를 설명합니다.</p><p className="muted">“어디를 보고 그렇게 생각했나요?”라고 물어보세요. 자료만으로 알기 어려운 점도 함께 적습니다.</p></div>
  return <div className="screen-card stack">
    <label htmlFor="exp-text">지진·화산은 판의 경계와 어떤 관련이 있나요? 관찰한 곳을 예로 들어 써 보세요.</label>
    <textarea id="exp-text" className="textarea" rows={5} maxLength={1500} value={text} disabled={ctx.locked || busy} onChange={e => { setText(e.target.value); setStatus('아직 저장하지 않았습니다.') }} placeholder="내가 관찰한 곳은 …" />
    <label htmlFor="exp-limits">이 자료만으로 알기 어려운 것은 무엇인가요?</label>
    <textarea id="exp-limits" className="textarea" rows={2} maxLength={1500} value={limits} disabled={ctx.locked || busy} onChange={e => { setLimits(e.target.value); setStatus('아직 저장하지 않았습니다.') }} placeholder="자료의 기간과 포함되지 않은 기록을 생각해 보세요." />
    <details className="simple-details"><summary>내가 담은 장면과 처음·나중 선 보기</summary><EvidenceStrip ctx={ctx} /><div className="compare-grid"><MiniMap ctx={ctx} kind="first" /><MiniMap ctx={ctx} kind="revised" /></div></details>
    <details className="simple-details"><summary>자료를 해석할 때 기억할 점</summary><p>지진은 2015–2024년 규모 5 이상 기록입니다. 화산은 약 1만 년 안에 활동한 흔적이 있는 화산 목록으로, 지금 분화 중이라는 뜻이 아닙니다. 두 자료의 기간과 수록 범위는 다릅니다. 점이 없는 곳이 안전하다는 뜻도 아닙니다.</p></details>
    <div className="row between"><span role="status" className="hint">{status || (dirty ? '아직 저장하지 않았습니다.' : ctx.record.explanation ? '저장된 설명입니다.' : '')}</span><Button variant="primary" loading={busy} disabledReason={ctx.locked ? '선생님이 입력을 잠갔습니다.' : busy ? '저장 중입니다.' : undefined} onClick={() => void save()}>설명 저장하기</Button></div>
  </div>
}
