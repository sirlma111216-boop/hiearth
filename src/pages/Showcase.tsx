// 시연 모드 — 교사가 혼자 전체 흐름을 보여 준다. 관측 자료는 실제 저장 자료, 가상 참가자는 항상 '시연용'으로 표시한다.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { GuessKind, LngLat, RoomMeta, SharedGuess, Stage } from '@shared/domain/types'
import { STAGE_INFO, emptyRecord } from '@shared/domain/activity'
import { REGION_PRESETS } from '@shared/domain/presets'
import { useLesson, LoadingScreen } from '../data/useLesson'
import type { LessonData } from '../data/lesson'
import { emptyDraft, makeRevision, reducer, type InquiryState } from '../inquiry/engine'
import { TopBar } from '../ui/TopBar'
import { Button } from '../ui/Button'
import { Workspace, type RoomContext } from '../workspace/Workspace'
import { ReportView } from '../report/ReportView'

interface SceneDef { id: string; title: string; caption: string; stage: Stage; view?: string; durationMs: number }

const SCENES: SceneDef[] = [
  { id: 'join', title: 'QR 입장', caption: '교사가 QR과 코드를 보여 주고, 학생은 별명만 입력해 들어옵니다. (아래 참가자는 시연용 가상 참가자입니다)', stage: 'observe', durationMs: 7000 },
  { id: 'observe', title: '지진 관찰', caption: '실제 USGS 지진 자료를 시간 순서로 재생하며 어떤 띠가 드러나는지 관찰합니다.', stage: 'observe', view: 'pacific', durationMs: 9000 },
  { id: 'guess', title: '최초 추론', caption: '지진 분포만 보고 판의 경계가 있을 것 같은 곳에 선을 그립니다. 제출된 최초 추론은 바뀌지 않습니다.', stage: 'firstGuess', view: 'pacific', durationMs: 9000 },
  { id: 'reveal', title: '추론 공개', caption: '교사가 공개하면 시연용 가상 참가자의 선이 지구본 위에 겹쳐 보입니다. 겹침은 의견 겹침이지 정답이 아닙니다.', stage: 'firstReveal', view: 'world', durationMs: 9000 },
  { id: 'volcano', title: '화산 공개', caption: '새 증거로 화산 위치(삼각형)가 추가됩니다. 지진 띠와 어디서 겹치는지 비교합니다.', stage: 'volcanoReveal', view: 'pacific', durationMs: 9000 },
  { id: 'revise', title: '수정 추론', caption: '최초 추론을 복사해 화산 증거를 반영해 고칩니다. 최초 기록은 그대로 남습니다.', stage: 'revise', view: 'japan', durationMs: 9000 },
  { id: 'compare', title: '경계 비교', caption: '연구 모형의 판 경계를 열어 내 선과 비교합니다. 점수를 매기지 않습니다.', stage: 'boundaryCompare', view: 'world', durationMs: 9000 },
  { id: 'report', title: '탐구 카드', caption: '처음 생각과 수정한 생각, 증거와 설명, 자료의 한계가 개인 보고서에 남습니다.', stage: 'wrapUp', durationMs: 10000 },
]

// 시연용 가상 참가자 선 — 손으로 적은 대략적 경로. 실제 수업 기록과 무관하며 항상 '시연용'으로 표시한다.
const DEMO_LINES: Record<string, LngLat[][]> = {
  '시연용 가상 참가자 1': [[[142, 45], [141, 38], [139, 33], [135, 30], [130, 27], [125, 22], [122, 15]], [[-70, -10], [-72, -20], [-73, -30], [-74, -40]]],
  '시연용 가상 참가자 2': [[[150, 50], [145, 42], [142, 36], [138, 31], [132, 27], [128, 22]], [[-120, 40], [-115, 32], [-105, 20], [-95, 12]]],
  '시연용 가상 참가자 3': [[[160, 55], [152, 47], [144, 40], [140, 34], [136, 30]], [[-30, 30], [-30, 15], [-25, 0], [-15, -20], [-10, -40]]],
}

export default function Showcase() {
  const { data, error, progress, retry } = useLesson()
  if (!data) return <LoadingScreen progress={progress} error={error} onRetry={retry} title="시연 모드를 준비하는 중" />
  return <ShowcaseInner data={data} />
}

function ShowcaseInner({ data }: { data: LessonData }) {
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [viewReq, setViewReq] = useState<{ view: { center: LngLat; zoom: number }; animate: boolean; seq: number } | null>(null)
  const seq = useRef(0)
  const [state, dispatch] = useReducer(reducer, undefined, (): InquiryState => ({ record: emptyRecord(data.datasetVersion), draft: emptyDraft(), submit: { kind: null, status: 'idle', message: null } }))
  const scene = SCENES[idx]

  const goto = useCallback((i: number) => {
    const target = Math.max(0, Math.min(SCENES.length - 1, i))
    setIdx(target)
    const s = SCENES[target]
    dispatch({ type: 'setStage', stage: s.stage })
    if (s.view) { const p = REGION_PRESETS.find((x) => x.id === s.view); if (p) { seq.current++; setViewReq({ view: p.view, animate: true, seq: seq.current }) } }
    // 시연을 위한 자동 초안: 최초 추론 장면에서 시연용 선을 그려 제출한 것으로 처리
    if (s.stage === 'firstGuess' && !state.record.firstGuess) {
      dispatch({ type: 'draft/loadFrom', guess: { lines: DEMO_LINES['시연용 가상 참가자 1'].map((pts, k) => ({ id: 'demo' + k, points: pts, mode: 'polyline', rawPointCount: pts.length })) } })
    }
    if (s.stage === 'firstReveal' && !state.record.firstGuess) {
      const rev = makeRevision('first', { ...emptyDraft(), lines: DEMO_LINES['시연용 가상 참가자 1'].map((pts, k) => ({ id: 'demo' + k, points: pts, mode: 'polyline' as const, rawPointCount: pts.length })) }, data.datasetVersion)
      dispatch({ type: 'submit/saved', revision: rev })
      dispatch({ type: 'draft/clear' })
    }
    if (s.stage === 'boundaryCompare' && !state.record.revisedGuess && state.record.firstGuess) {
      const lines = state.record.firstGuess.guess.lines.map((l, k) => ({ ...l, id: 'rev' + k, points: l.points.map(([x, y]) => [x + (k === 0 ? 1.5 : 0), y] as LngLat) }))
      dispatch({ type: 'submit/saved', revision: makeRevision('revised', { ...emptyDraft(), lines }, data.datasetVersion) })
    }
    if (s.stage === 'wrapUp' && !state.record.explanation) {
      dispatch({ type: 'explanation/set', text: '(시연용 예시) 증거 1에서 태평양 가장자리를 따라 지진이 띠를 이루고, 화산도 같은 띠 위에 많이 분포했다. 판 경계 모형과 비교하니 내 선은 일본 주변에서는 비슷했지만 남아메리카 서안에서는 조금 안쪽으로 그렸다.', limitations: '(시연용 예시) 규모 5.0 이상만 보았고 화산 목록은 지금 분화 중인 목록이 아니다.' })
    }
  }, [data.datasetVersion, state.record.firstGuess, state.record.revisedGuess, state.record.explanation])

  useEffect(() => { goto(0) }, [])
  useEffect(() => {
    if (!playing) return
    const t = setTimeout(() => { if (idx < SCENES.length - 1) goto(idx + 1); else setPlaying(false) }, scene.durationMs)
    return () => clearTimeout(t)
  }, [playing, idx, scene.durationMs, goto])

  const meta: RoomMeta = useMemo(() => ({
    code: 'DEMO00', title: '시연용 탐사실', datasetId: data.datasetVersion, startRegion: 'world', maxParticipants: 40, groups: [], createdAt: Date.now(), expiresAt: Date.now() + 3600_000, endedAt: null, status: 'open',
    stage: scene.stage, joinLocked: false, inputLocked: false,
    revealed: { firstGuesses: STAGE_INFO[scene.stage].index >= STAGE_INFO.firstReveal.index, volcanoes: STAGE_INFO[scene.stage].volcanoes, boundaries: STAGE_INFO[scene.stage].boundaries, nicknames: true },
    followView: null, activityVersion: 1, roomRevision: idx + 1,
  }), [scene.stage, idx, data.datasetVersion])
  const shared: SharedGuess[] = useMemo(() => Object.entries(DEMO_LINES).slice(1).map(([name, lines], k) => ({ participantId: 'demo' + k, nickname: name, group: null, kind: 'first' as const, guess: { lines: lines.map((pts, j) => ({ id: `d${k}${j}`, points: pts, mode: 'polyline' as const, rawPointCount: pts.length })) }, submittedAt: Date.now() })), [])
  const room: RoomContext = { meta, sharedGuesses: meta.revealed.firstGuesses ? shared : [], highlighted: [], connection: 'open', queued: 0, participantCount: 3, myParticipantId: 'me' }

  const onSubmit = (kind: GuessKind) => { dispatch({ type: 'submit/saved', revision: makeRevision(kind, state.draft, data.datasetVersion) }) }

  return (
    <>
      <TopBar center={<span className="status-pill chip-brass"><strong>시연 모드</strong> · 실제 수업 기록이 아닙니다</span>} />
      {scene.id === 'join' ? (
        <div className="lobby" style={{ paddingTop: 'calc(var(--topbar-h) + 24px)' }}>
          <div className="lobby-bg" aria-hidden="true"><img src="/images/lobby-observatory.webp" alt="" /></div>
          <div className="stack" style={{ gap: 18 }}>
            <span className="eyebrow">Scan to Join · 시연</span>
            <div className="room-code">DEMO00</div>
            <div className="qr-card" aria-label="시연용 QR 자리"><div style={{ width: 220, height: 220, display: 'grid', placeItems: 'center', color: '#333', fontSize: 13, textAlign: 'center', border: '2px dashed #999', borderRadius: 8 }}>실제 수업에서는<br />여기에 입장 QR이 생깁니다</div></div>
            <div className="stack" style={{ gap: 4 }}>
              {Object.keys(DEMO_LINES).map((n) => <span key={n} className="chip chip-brass">{n} · 입장함</span>)}
            </div>
            <p className="tiny muted">위 참가자는 시연용 가상 참가자이며 실제 수업 기록과 분리되어 있습니다.</p>
          </div>
          <div aria-hidden="true" />
        </div>
      ) : scene.id === 'report' ? (
        <ReportView data={data} record={state.record} nickname="시연용 가상 참가자 1" title="시연용 탐구 카드" backHref="/showcase" />
      ) : (
        <Workspace data={data} state={state} dispatch={dispatch} role="student" room={room} onSubmit={onSubmit} onStage={(s) => goto(SCENES.findIndex((x) => x.stage === s))}
          onExplanation={(t, l) => dispatch({ type: 'explanation/set', text: t, limitations: l })} externalView={viewReq} startRegion={scene.view ?? 'world'} />
      )}
      <div className="showcase-badge chip chip-brass">시연 모드 · 가상 참가자 3명</div>
      <div className="panel showcase-caption" aria-live="polite"><strong>{idx + 1}/{SCENES.length} {scene.title}</strong> — {scene.caption}</div>
      <div className="panel showcase-bar" role="toolbar" aria-label="시연 제어">
        <Button size="sm" variant="quiet" icon="prev" onClick={() => goto(idx - 1)} disabledReason={idx === 0 ? '첫 장면입니다' : undefined} aria-label="이전 장면" />
        <Button size="sm" variant={playing ? 'secondary' : 'primary'} icon={playing ? 'pause' : 'play'} onClick={() => setPlaying((p) => !p)}>{playing ? '자동 진행 중지' : '자동 진행'}</Button>
        <Button size="sm" variant="quiet" icon="next" onClick={() => goto(idx + 1)} disabledReason={idx === SCENES.length - 1 ? '마지막 장면입니다' : undefined} aria-label="다음 장면" />
        <select className="select" style={{ width: 'auto', minHeight: 36, fontSize: 13, padding: '2px 8px' }} value={idx} onChange={(e) => goto(Number(e.target.value))} aria-label="장면 이동">
          {SCENES.map((s, i) => <option key={s.id} value={i}>{i + 1}. {s.title}</option>)}
        </select>
        <Link to="/" className="btn btn-quiet btn-sm">종료</Link>
      </div>
    </>
  )
}
