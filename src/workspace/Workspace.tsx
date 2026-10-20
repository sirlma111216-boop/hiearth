// 탐구 작업 공간 — 혼자 탐사·학생 탐사실·교사 발표가 같은 엔진과 화면을 공유한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Evidence, GuessKind, LayerId, MapMode, RoomMeta, SharedGuess, Stage, ViewState } from '@shared/domain/types'
import { MAX_EVIDENCE } from '@shared/domain/types'
import { STAGE_INFO, reached } from '@shared/domain/activity'
import { REGION_PRESETS, presetById } from '@shared/domain/presets'
import { isoDateUtc } from '@shared/geo/time'
import type { LessonData } from '../data/lesson'
import { loadRecent, type RecentData, type RecentFeedId } from '../data/recent'
import type { Action, InquiryState } from '../inquiry/engine'
import { newId } from '../inquiry/ids'
import { MapView, type MapViewHandle } from '../map/MapView'
import type { Interaction, MapEvents, MapScene, Pick as MapPick, RenderGuess } from '../map/types'
import { ALL_LAYERS } from '../map/types'
import { visibleEarthquakeCount } from '../map/scene2d'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { useSettings, updateSettings } from '../settings/settings'
import { audio } from '../audio/AudioManager'
import { EvidenceDrawer, type DatasetChoice } from './EvidenceDrawer'
import { InferencePanel } from './InferencePanel'
import { InfoPanel } from './InfoPanel'
import { RevealScene } from './RevealScene'
import { StageBanner } from './StageBanner'
import { TimeControls } from './TimeControls'
import { LayerControls } from './LayerControls'
import { useTimePlayback } from './useTimePlayback'
import type { ConnectionState } from '../realtime/RoomClient'

export interface RoomContext {
  meta: RoomMeta
  sharedGuesses: SharedGuess[]
  highlighted: string[]
  connection: ConnectionState
  queued: number
  participantCount: number
  myParticipantId: string | null
}

export interface WorkspaceProps {
  data: LessonData
  state: InquiryState
  dispatch: (a: Action) => void
  role: 'solo' | 'student' | 'teacher'
  room?: RoomContext
  /** 제출: 상위가 서버 전송/로컬 저장을 처리한다 */
  onSubmit: (kind: GuessKind) => void
  onStage: (s: Stage) => void
  onEvidenceChange?: (list: Evidence[]) => void
  onExplanation: (text: string, limitations: string) => void
  onShareView?: (view: ViewState, mode: MapMode, force: boolean) => void
  presentation?: boolean
  onPresentation?: (v: boolean) => void
  startRegion?: string
  /** 시연 모드에서 외부가 시점을 제어 */
  externalView?: { view: ViewState; animate: boolean; seq: number } | null
  reportHref?: string
  extraTop?: React.ReactNode
  /** 수업 화면 카드 안에 끼워 넣을 때: 고정 배치 대신 부모 상자를 채운다 */
  embedded?: boolean
  /** 이 화면에서 보여 줄 패널. 기본은 모두 */
  panels?: { banner?: boolean; evidence?: boolean; tools?: boolean; time?: boolean; mobileTabs?: boolean }
  /** 이 화면에서 처음 들어올 때 보여 줄 공개 장면 */
  reveal?: 'volcano' | 'boundary' | null
  /** 처음 켤 레이어 (지정한 것만 덮어씀) */
  initialLayers?: Partial<Record<LayerId, boolean>>
  /** 시간 관찰 활동에 진입할 때 시작 시점의 누적 보기로 맞춘다 */
  startTimeAtBeginning?: boolean
  /** 수업 화면이 정하는 활동 상태 (기록의 stage 대신 사용) */
  stageOverride?: Stage
  /** 패널 초기 열림 (기본: 둘 다 열림) */
  defaultOpen?: { evidence?: boolean; tools?: boolean }
}

type Sheet = null | 'evidence' | 'tools' | 'time' | 'layers'

export function Workspace(p: WorkspaceProps) {
  const toast = useToast()
  const settings = useSettings()
  const { data, state, dispatch, role } = p
  const stage = p.stageOverride ?? state.record.stage
  const info = STAGE_INFO[stage]
  const firstSubmitted = info.drawing === 'first' && !!state.record.firstGuess
  const roomMeta = p.room?.meta
  const maxStage: Stage = role === 'student' && roomMeta ? roomMeta.stage : 'wrapUp'

  // ----- 지도 상태 -----
  const mapRef = useRef<MapViewHandle>(null)
  const [mapMode, setMapMode] = useState<MapMode>(settings.lowPower ? '2d' : settings.preferredMapMode)
  const [interactionMode, setInteractionMode] = useState<'move' | 'draw'>('move')
  const [layers, setLayers] = useState<Record<LayerId, boolean>>({ ...ALL_LAYERS, ...(p.initialLayers ?? {}) })
  const show = { banner: true, evidence: true, tools: true, time: true, mobileTabs: true, ...(p.panels ?? {}) }
  const [minMag, setMinMag] = useState(0)
  const [pick, setPick] = useState<MapPick>(null)
  const [leftOpen, setLeftOpen] = useState(p.defaultOpen?.evidence ?? true)
  const [rightOpen, setRightOpen] = useState(p.defaultOpen?.tools ?? true)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [reveal, setReveal] = useState<null | 'volcano' | 'boundary'>(null)
  const [overlapEmphasis, setOverlapEmphasis] = useState(false)
  const [followTeacher, setFollowTeacher] = useState(false)
  const [requestedView, setRequestedView] = useState<{ view: ViewState; animate: boolean; seq: number } | null>(null)
  const seq = useRef(0)
  // 세로 화면(휴대전화)에서는 전 지구가 얇은 띠로 보이지 않도록 시작 배율을 키운다
  const portraitFactor = typeof window !== 'undefined' && window.innerHeight > window.innerWidth * 1.2 ? Math.min(2.2, window.innerHeight / window.innerWidth) : 1
  const initialView = useMemo(() => { const v = presetById(p.startRegion ?? roomMeta?.startRegion ?? 'world').view; return { center: v.center, zoom: v.zoom * portraitFactor } }, [p.startRegion, roomMeta?.startRegion, portraitFactor])
  const currentView = useRef<ViewState>(initialView)
  const requestView = useCallback((view: ViewState, animate = true) => { seq.current++; setRequestedView({ view, animate, seq: seq.current }) }, [])

  useEffect(() => { if (p.externalView) setRequestedView(p.externalView) }, [p.externalView])

  // ----- 자료 선택 (수업용 저장 자료 / 최근 피드) -----
  const [choice, setChoice] = useState<DatasetChoice>({ kind: 'lesson', feed: '4.5_month' })
  const [recent, setRecent] = useState<{ data: RecentData | null; loading: boolean; error: string | null }>({ data: null, loading: false, error: null })
  const refreshRecent = useCallback(async (feed: RecentFeedId) => {
    setRecent((r) => ({ ...r, loading: true, error: null }))
    try {
      const d = await loadRecent(feed)
      setRecent({ data: d, loading: false, error: null })
    } catch (e) {
      setRecent((r) => ({ data: r.data, loading: false, error: e instanceof Error ? e.message : '최근 자료를 받지 못했습니다.' }))
    }
  }, [])
  useEffect(() => {
    if (choice.kind !== 'recent') return
    void refreshRecent(choice.feed)
    const t = setInterval(() => void refreshRecent(choice.feed), 10 * 60 * 1000)
    return () => clearInterval(t)
  }, [choice, refreshRecent])

  const earthquakes = choice.kind === 'recent' && recent.data ? recent.data.earthquakes : data.earthquakes
  const timeRangeAll = useMemo(() => {
    if (choice.kind === 'recent' && recent.data && recent.data.earthquakes.length) return { min: recent.data.earthquakes[0].time, max: recent.data.earthquakes[recent.data.earthquakes.length - 1].time }
    return data.timeRange
  }, [choice.kind, recent.data, data.timeRange])
  const times = useMemo(() => earthquakes.map((e) => e.time), [earthquakes])
  const playback = useTimePlayback(timeRangeAll, p.startTimeAtBeginning)

  // ----- 단계에 따른 레이어 가용성 -----
  const volcanoesAllowed = role === 'teacher' ? true : role === 'student' && roomMeta ? roomMeta.revealed.volcanoes : reached(stage, 'volcanoReveal')
  const boundariesAllowed = role === 'teacher' ? true : role === 'student' && roomMeta ? roomMeta.revealed.boundaries : reached(stage, 'boundaryCompare')
  const layerAvailability: Partial<Record<LayerId, string>> = {}
  if (!volcanoesAllowed) layerAvailability.volcanoes = '아직 공개 전'
  if (!boundariesAllowed) layerAvailability.plates = '아직 공개 전'
  if (role === 'teacher') {
    if (!p.room?.sharedGuesses.some((g) => g.kind === 'first')) layerAvailability.myFirst = '제출 전'
    if (!p.room?.sharedGuesses.some((g) => g.kind === 'revised')) layerAvailability.myRevised = '제출 전'
  } else {
    if (!state.record.firstGuess && info.drawing !== 'first') layerAvailability.myFirst = '제출 전'
    if (!state.record.revisedGuess && info.drawing !== 'revised') layerAvailability.myRevised = '제출 전'
  }
  if (role === 'solo') layerAvailability.others = '혼자 탐사'
  else if (p.room && !p.room.sharedGuesses.length) layerAvailability.others = '공개 전'

  // 단계가 바뀌면 관련 레이어를 자동으로 켜고 공개 장면을 보여준다
  const seenReveal = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (info.volcanoes && volcanoesAllowed) setLayers((l) => ({ ...l, volcanoes: true }))
    if (info.boundaries && boundariesAllowed) setLayers((l) => ({ ...l, plates: true }))
    const wantReveal = p.reveal === undefined ? (stage === 'volcanoReveal' ? 'volcano' : stage === 'boundaryCompare' ? 'boundary' : null) : p.reveal
    if (wantReveal === 'volcano' && stage === 'volcanoReveal' && volcanoesAllowed && !seenReveal.current.has('volcano')) { seenReveal.current.add('volcano'); setReveal('volcano'); void audio.play('evidence-reveal') }
    if (wantReveal === 'boundary' && stage === 'boundaryCompare' && boundariesAllowed && !seenReveal.current.has('boundary')) { seenReveal.current.add('boundary'); setReveal('boundary'); void audio.play('boundary-reveal') }
    if (stage === 'wrapUp') void audio.play('report-ready')
    if (info.drawing === 'none') setInteractionMode('move')
    else setInteractionMode('draw')
    // 새로고침한 경우 마지막 수정 제출에서 이어 쓴다. 최초 진입만 최초 추론을 복사한다.
    if (info.drawing === 'revised' && state.draft.lines.length === 0) {
      const saved = state.record.revisedGuess ?? state.record.firstGuess
      if (saved) dispatch({ type: 'draft/loadFrom', guess: saved.guess })
    }
    if (info.drawing === 'first' && state.record.firstGuess) setInteractionMode('move')

  }, [stage, volcanoesAllowed, boundariesAllowed])

  // 교사 따라가기
  const lastFollow = useRef(0)
  useEffect(() => {
    const fv = roomMeta?.followView
    if (!fv || role !== 'student') return
    if (fv.requestedAt === lastFollow.current) return
    if (fv.force || followTeacher) {
      lastFollow.current = fv.requestedAt
      if (fv.mode !== mapMode) setMapMode(fv.mode)
      requestView(fv.view, true)
      if (fv.force) toast.push('선생님이 "모두 이곳 보기"를 요청해 지도를 이동했습니다.')
    }
  }, [roomMeta?.followView, followTeacher, role, mapMode, requestView, toast])

  // ----- 장면 구성 -----
  const guesses = useMemo<RenderGuess[]>(() => {
    const out: RenderGuess[] = []
    const myId = p.room?.myParticipantId
    const draftKind = info.drawing
    if (p.room) {
      const hl = p.room.highlighted
      for (const g of p.room.sharedGuesses) {
        if (role === 'student' && g.participantId === myId) continue
        if (g.kind === 'first' && !roomMeta?.revealed.firstGuesses && role !== 'teacher') continue
        const idx = hl.indexOf(g.participantId)
        const style = idx === 0 ? 'highlightA' : idx === 1 ? 'highlightB' : 'others'
        if (style === 'others' && g.kind === 'revised' && hl.length) continue
        out.push({ id: `${g.participantId}:${g.kind}`, style, layer: role === 'teacher' ? (g.kind === 'first' ? 'myFirst' : 'myRevised') : 'others', lines: g.guess.lines.map((l) => l.points), label: g.nickname ?? undefined })
      }
    }
    if (role !== 'teacher') {
      if (state.record.firstGuess) out.push({ id: 'my-first', style: 'first', lines: state.record.firstGuess.guess.lines.map((l) => l.points) })
      if (state.record.revisedGuess && draftKind !== 'revised') out.push({ id: 'my-revised', style: 'revised', lines: state.record.revisedGuess.guess.lines.map((l) => l.points) })
      if (draftKind !== 'none' && !(draftKind === 'first' && state.record.firstGuess)) {
        const style = draftKind === 'first' ? 'first' : 'revised'
        for (const l of state.draft.lines) out.push({ id: 'draft:' + l.id, style: state.draft.selectedLineId === l.id ? 'draft' : style, layer: draftKind === 'first' ? 'myFirst' : 'myRevised', lines: [l.points] })
      }
    }
    return out
  }, [p.room, role, state.record.firstGuess, state.record.revisedGuess, state.draft.lines, state.draft.selectedLineId, info.drawing, roomMeta?.revealed.firstGuesses])

  const scene = useMemo<MapScene>(() => ({
    earthquakes,
    volcanoes: data.volcanoes,
    plates: data.plates,
    land: data.land,
    layers: { ...layers, volcanoes: layers.volcanoes && volcanoesAllowed, plates: layers.plates && boundariesAllowed },
    timeRange: playback.timeRange,
    minMagnitude: minMag,
    guesses,
    draft: !firstSubmitted && layers[info.drawing === 'revised' ? 'myRevised' : 'myFirst'] && interactionMode === 'draw' && (state.draft.pending.length || state.draft.cursor) ? { points: state.draft.pending, mode: state.draft.mode, cursor: state.draft.cursor } : null,
    selected: pick,
    overlapEmphasis,
  }), [earthquakes, data.volcanoes, data.plates, data.land, layers, volcanoesAllowed, boundariesAllowed, playback.timeRange, minMag, guesses, interactionMode, state.draft.pending, state.draft.mode, state.draft.cursor, pick, overlapEmphasis, firstSubmitted, info.drawing])

  const visibleCount = useMemo(() => visibleEarthquakeCount(scene), [scene])

  const inputLocked = role === 'student' && (roomMeta?.inputLocked || roomMeta?.status !== 'open')
  const drawingLocked = inputLocked || firstSubmitted || role === 'teacher' || info.drawing === 'none' || state.submit.status === 'pending' || state.submit.status === 'queued'
  const interaction = useMemo<Interaction>(() => ({ mode: drawingLocked ? 'move' : interactionMode, drawMode: state.draft.mode }), [drawingLocked, interactionMode, state.draft.mode])
  const showDrawingLayer = useCallback(() => {
    const id = info.drawing === 'revised' ? 'myRevised' : 'myFirst'
    setLayers((current) => current[id] ? current : { ...current, [id]: true })
  }, [info.drawing])
  const changeLayer = useCallback((id: LayerId, on: boolean) => {
    setLayers((current) => ({ ...current, [id]: on }))
    setPick(null)
  }, [])
  const showBaseMap = useCallback(() => {
    setLayers({ earthquakes: false, volcanoes: false, plates: false, myFirst: false, myRevised: false, others: false })
    setPick(null)
  }, [])

  const events = useMemo<MapEvents>(() => ({
    onViewChange: (v) => { currentView.current = v },
    onPick: (pk) => { setPick(pk); if (pk) void audio.play('ui-tap') },
    onDrawPoint: (pt) => { if (!drawingLocked) { showDrawingLayer(); dispatch({ type: 'draft/addPoint', point: pt }) } },
    onDrawProgress: () => { if (!drawingLocked) showDrawingLayer() },
    onDrawStroke: (pts) => { if (!drawingLocked) { showDrawingLayer(); dispatch({ type: 'draft/stroke', points: pts, zoom: currentView.current.zoom }) } },
    onDrawCursor: (pt) => { if (!drawingLocked) dispatch({ type: 'draft/cursor', point: pt }) },
    onDrawKey: (k) => {
      if (drawingLocked) return
      if (k === 'add') { showDrawingLayer(); dispatch({ type: 'draft/addPoint', point: mapRef.current?.centerLngLat() ?? currentView.current.center }) }
      if (k === 'undo') dispatch({ type: 'draft/undoPoint' })
      if (k === 'finish') dispatch({ type: 'draft/finishPending' })
    },
    onInteract: () => { if (followTeacher) { /* 사용자가 조작하면 따라가기를 끄지 않고 유지하되 강제 이동만 적용 */ } },
  }), [dispatch, drawingLocked, followTeacher, showDrawingLayer])

  // ----- 증거 담기 -----
  const captureEvidence = useCallback(async () => {
    if (state.record.evidence.length >= MAX_EVIDENCE) return
    const img = await mapRef.current?.capture(800)
    const view = mapRef.current?.getView() ?? currentView.current
    const ev: Evidence = {
      id: newId('ev'),
      createdAt: Date.now(),
      title: '',
      note: '',
      view,
      mapMode,
      timeWindow: playback.timeRange ? { start: playback.timeRange.min, end: playback.timeRange.max } : null,
      minMagnitude: minMag,
      layers: (Object.keys(scene.layers) as LayerId[]).filter((k) => scene.layers[k]),
      selectedEventIds: pick ? [pick.id] : [],
      datasetVersion: choice.kind === 'recent' ? `usgs-feed-${choice.feed}-${isoDateUtc(recent.data?.receivedAt ?? Date.now())}` : data.datasetVersion,
      capture: img ?? null,
    }
    dispatch({ type: 'evidence/add', evidence: ev })
    p.onEvidenceChange?.([...state.record.evidence, ev])
    void audio.play('ui-tap')
    toast.push(img ? '관찰 증거를 담았습니다. 제목과 메모를 적어 두세요.' : '캡처는 실패했지만 조건은 저장했습니다.', 'success')
  }, [state.record.evidence, mapMode, playback.timeRange, minMag, scene.layers, pick, choice, recent.data, data.datasetVersion, dispatch, p, toast])

  const updateEvidence = useCallback((id: string, patch: { title?: string; note?: string }) => {
    if (inputLocked) return
    dispatch({ type: 'evidence/update', id, patch })
    p.onEvidenceChange?.(state.record.evidence.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }, [dispatch, p, state.record.evidence, inputLocked])
  const removeEvidence = useCallback((id: string) => {
    if (inputLocked) return
    dispatch({ type: 'evidence/remove', id })
    p.onEvidenceChange?.(state.record.evidence.filter((e) => e.id !== id))
  }, [dispatch, p, state.record.evidence, inputLocked])

  const pickedItem = useMemo(() => {
    if (!pick) return null
    if (pick.kind === 'earthquake') { const e = earthquakes.find((q) => q.id === pick.id); return e ? { kind: 'earthquake' as const, data: e } : null }
    const v = data.volcanoes.find((x) => String(x.number) === pick.id)
    return v ? { kind: 'volcano' as const, data: v } : null
  }, [pick, earthquakes, data.volcanoes])

  const switchMode = (m: MapMode) => { setMapMode(m); updateSettings({ preferredMapMode: m }) }
  const presentation = !!p.presentation
  const connectionLabel = p.room ? ({ idle: '대기', connecting: '연결 중', open: '연결됨', reconnecting: '재연결 중', closed: '연결 끊김' } as const)[p.room.connection] : null

  const versionText = reveal === 'volcano'
    ? `${data.manifest.datasets.volcanoes.provider} · ${data.manifest.datasets.volcanoes.recordCount}개 · 수집 ${isoDateUtc(Date.parse(data.manifest.datasets.volcanoes.retrievedAt))}`
    : `${data.manifest.datasets.plateBoundaries.provider} · ${data.manifest.datasets.plateBoundaries.recordCount}개 선분 · 수집 ${isoDateUtc(Date.parse(data.manifest.datasets.plateBoundaries.retrievedAt))}`

  const nextDisabledReason = role === 'solo' && stage === 'firstGuess' && !state.record.firstGuess ? '최초 추론을 제출하면 다음으로 넘어갈 수 있습니다' : undefined

  return (
    <div className={'workspace' + (presentation ? ' presentation' : '') + (p.embedded ? ' embedded' : '') + (!presentation && show.banner ? ' has-stage-banner' : '')}>
      <div className="workspace-bg" aria-hidden="true"><img src="/images/workspace-atmosphere.webp" alt="" /></div>

      <MapView ref={mapRef} mode={mapMode} scene={scene} interaction={interaction} events={events} initialView={initialView} requestedView={requestedView}
        onModeFallback={(reason) => { setMapMode('2d'); toast.push(reason, 'info') }} />
      <LayerControls layers={layers} unavailable={layerAvailability} teacher={role === 'teacher'} onLayer={changeLayer} onBase={showBaseMap} />

      {!presentation && show.banner ? (
        <StageBanner stage={stage} maxStage={maxStage} onStage={p.onStage} nextDisabledReason={nextDisabledReason} role={role} />
      ) : null}

      {/* 왼쪽 레일: 패널 토글 + 지도 모드 */}
      <div className="ws-rail" role="toolbar" aria-label="지도 도구">
        {!presentation && show.evidence ? <Button size="sm" variant="quiet" icon="evidence" active={leftOpen} onClick={() => setLeftOpen((v) => !v)} aria-label="증거 서랍 열기/닫기" title="증거 서랍" className="hide-mobile" /> : null}
        <Button size="sm" variant="quiet" icon={mapMode === '3d' ? 'map' : 'globe'} onClick={() => switchMode(mapMode === '3d' ? '2d' : '3d')} aria-label={mapMode === '3d' ? '2D 지도로 전환' : '3D 지구본으로 전환'} title={mapMode === '3d' ? '2D 지도' : '3D 지구본'} />
        <select className="select" style={{ minHeight: 40, padding: '4px 8px', fontSize: 13, width: 'auto' }} aria-label="탐구 위치 프리셋" value="" onChange={(e) => { const pr = REGION_PRESETS.find((x) => x.id === e.target.value); if (pr) requestView({ center: pr.view.center, zoom: pr.view.zoom * portraitFactor }) }}>
          <option value="">위치 이동…</option>
          {REGION_PRESETS.map((pr) => <option key={pr.id} value={pr.id}>{pr.label}</option>)}
        </select>
        {role === 'teacher' && p.onShareView ? (
          <>
            <Button size="sm" variant="secondary" icon="target" onClick={() => p.onShareView?.(mapRef.current?.getView() ?? currentView.current, mapMode, true)} title="학생 모두의 지도를 이 위치로 이동">모두 이곳 보기</Button>
            <Button size="sm" variant="quiet" icon="link" onClick={() => p.onShareView?.(mapRef.current?.getView() ?? currentView.current, mapMode, false)} title="따라가기를 켠 학생에게만 적용">조건 공유</Button>
          </>
        ) : null}
        {role === 'student' ? (
          <Button size="sm" variant="quiet" icon="target" active={followTeacher} onClick={() => setFollowTeacher((v) => !v)} title="교사 화면 따라가기">{followTeacher ? '따라가는 중' : '교사 화면 따라가기'}</Button>
        ) : null}
      </div>
      <div className="ws-rail ws-rail-right">
        {!presentation && role !== 'teacher' && show.tools ? <Button size="sm" variant="quiet" icon="draw" active={rightOpen} onClick={() => setRightOpen((v) => !v)} aria-label="추론 도구 열기/닫기" title="추론 도구" /> : null}
        {p.onPresentation ? <Button size="sm" variant="quiet" icon={presentation ? 'compress' : 'expand'} onClick={() => p.onPresentation?.(!presentation)} aria-label={presentation ? '발표 모드 종료' : '전체화면 발표'} title={presentation ? '발표 모드 종료 (Esc)' : '전체화면 발표'} /> : null}
      </div>

      {!presentation && show.evidence ? (
        <aside className={'ws-left' + (leftOpen ? '' : ' is-closed')} aria-label="증거 서랍">
          <EvidenceDrawer lesson={data} recent={recent} choice={choice} onChoice={setChoice} onRefreshRecent={() => void refreshRecent(choice.feed)}
            layers={layers} layerAvailability={layerAvailability} onLayer={changeLayer}
            minMagnitude={minMag} onMinMagnitude={setMinMag} evidence={state.record.evidence}
            canCapture={state.record.evidence.length < MAX_EVIDENCE && !inputLocked} captureDisabledReason={inputLocked ? '입력이 잠겨 있습니다' : undefined} onCapture={() => void captureEvidence()}
            onEvidenceNote={updateEvidence} onEvidenceRemove={removeEvidence} visibleCount={visibleCount} inputLocked={inputLocked}
            overlapEmphasis={overlapEmphasis} onOverlapEmphasis={p.room ? setOverlapEmphasis : undefined} readOnly={role === 'teacher'} />
        </aside>
      ) : null}

      {!presentation && role !== 'teacher' && show.tools ? (
        <aside className={'ws-right' + (rightOpen ? '' : ' is-closed')} aria-label="추론 도구">
          <InferencePanel state={state} stage={stage} mode={interactionMode} onMode={(m) => { setInteractionMode(m); mapRef.current?.focus() }} onDrawMode={(m) => dispatch({ type: 'draft/setMode', mode: m })}
            onUndo={() => dispatch({ type: 'draft/undoPoint' })} onRedo={() => dispatch({ type: 'draft/redo' })} onDeleteSelected={() => dispatch({ type: 'draft/deleteSelected' })} onClear={() => dispatch({ type: 'draft/clear' })}
            onSelectLine={(id) => dispatch({ type: 'draft/select', lineId: id })} onFinishPending={() => dispatch({ type: 'draft/finishPending' })}
            onCopyFirst={() => { if (state.record.firstGuess) dispatch({ type: 'draft/loadFrom', guess: state.record.firstGuess.guess }) }}
            onSubmit={p.onSubmit} onExplanation={p.onExplanation} inputLocked={inputLocked} lockedReason={roomMeta?.status !== 'open' ? '탐사실이 종료되었습니다.' : undefined} role={role} />
        </aside>
      ) : null}

      {show.time ? <div className="ws-bottom">
        <TimeControls times={times} range={timeRangeAll} state={playback.state} visibleCount={visibleCount} totalCount={earthquakes.length}
          onPlay={playback.play} onPause={playback.pause} onRewind={playback.rewind} onSeek={playback.seek} onMode={playback.setMode} onSpeed={playback.setSpeed} onWindowDays={playback.setWindowDays} compact={presentation || !!p.embedded} />
      </div> : null}

      {pickedItem ? <InfoPanel item={pickedItem} onClose={() => setPick(null)} /> : null}

      {reveal ? <RevealScene kind={reveal} versionText={versionText} onClose={() => setReveal(null)} /> : null}

      {/* 모바일: 하단 탭 + 시트 */}
      {!presentation && show.mobileTabs ? (
        <>
          <nav className="mobile-tabs" aria-label="모바일 패널">
            <Button variant="quiet" icon="map" active={sheet === null} onClick={() => setSheet(null)}>지도</Button>
            {show.evidence ? <Button variant="quiet" icon="evidence" active={sheet === 'evidence'} onClick={() => setSheet(sheet === 'evidence' ? null : 'evidence')}>증거</Button> : null}
            {role !== 'teacher' && show.tools ? <Button variant="quiet" icon="draw" active={sheet === 'tools'} onClick={() => setSheet(sheet === 'tools' ? null : 'tools')}>추론</Button> : null}
            {show.banner ? <Button variant="quiet" icon="info" onClick={() => toast.push(`${info.title} — ${info.guidance}`)}>안내</Button> : null}
          </nav>
          <div className={'sheet' + (sheet ? ' is-open' : '')} role="dialog" aria-label={sheet === 'evidence' ? '증거 서랍' : '추론 도구'} aria-hidden={!sheet}>
            <div className="sheet-handle" />
            <div className="row between" style={{ marginBottom: 6 }}>
              <strong>{sheet === 'evidence' ? '증거 서랍' : '추론 도구'}</strong>
              <Button size="sm" variant="quiet" icon="close" onClick={() => setSheet(null)} aria-label="닫기" />
            </div>
            <div style={{ overflow: 'auto', minHeight: 0 }}>
              {sheet === 'evidence' ? (
                <EvidenceDrawer lesson={data} recent={recent} choice={choice} onChoice={setChoice} onRefreshRecent={() => void refreshRecent(choice.feed)}
                  layers={layers} layerAvailability={layerAvailability} onLayer={changeLayer}
                  minMagnitude={minMag} onMinMagnitude={setMinMag} evidence={state.record.evidence}
                  canCapture={state.record.evidence.length < MAX_EVIDENCE && !inputLocked} captureDisabledReason={inputLocked ? '입력이 잠겨 있습니다' : undefined} inputLocked={inputLocked} onCapture={() => { setSheet(null); setTimeout(() => void captureEvidence(), 350) }}
                  onEvidenceNote={updateEvidence} onEvidenceRemove={removeEvidence} visibleCount={visibleCount} readOnly={role === 'teacher'} />
              ) : null}
              {sheet === 'tools' && role !== 'teacher' ? (
                <InferencePanel state={state} stage={stage} mode={interactionMode} onMode={(m) => { setInteractionMode(m); setSheet(null) }} onDrawMode={(m) => { dispatch({ type: 'draft/setMode', mode: m }); setSheet(null) }}
                  onUndo={() => dispatch({ type: 'draft/undoPoint' })} onRedo={() => dispatch({ type: 'draft/redo' })} onDeleteSelected={() => dispatch({ type: 'draft/deleteSelected' })} onClear={() => dispatch({ type: 'draft/clear' })}
                  onSelectLine={(id) => dispatch({ type: 'draft/select', lineId: id })} onFinishPending={() => dispatch({ type: 'draft/finishPending' })}
                  onCopyFirst={() => { if (state.record.firstGuess) dispatch({ type: 'draft/loadFrom', guess: state.record.firstGuess.guess }) }}
                  onSubmit={(k) => { setSheet(null); p.onSubmit(k) }} onExplanation={p.onExplanation} inputLocked={inputLocked} role={role} />
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {/* 상단 바 가운데 슬롯용 상태 */}
      {p.extraTop}
      {p.room && connectionLabel ? (
        <div style={{ position: 'absolute', right: 12, top: 'calc(var(--topbar-h) + 60px)', zIndex: 7 }} className="status-pill ws-conn" aria-live="polite">
          <span className={'dot ' + (p.room.connection === 'open' ? 'dot-on' : p.room.connection === 'reconnecting' ? 'dot-warn' : 'dot-off')} />
          {connectionLabel}{p.room.queued ? ` · 전송 대기 ${p.room.queued}` : ''}{role === 'teacher' ? ` · 참가 ${p.room.participantCount}명` : ''}
        </div>
      ) : null}
      {stage === 'wrapUp' && p.reportHref && !presentation ? (
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 136, zIndex: 9 }}>
          <a className="btn btn-primary" href={p.reportHref}><Icon name="evidence" /> 탐구 카드 보기</a>
        </div>
      ) : null}
    </div>
  )
}
