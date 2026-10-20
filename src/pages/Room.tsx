// 학생 탐사실 — 서버가 권위를 갖는 교실 상태 + 내 기록. 선생님 화면을 따라가되 끌 수 있다.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Evidence, GuessKind, InquiryRecord } from '@shared/domain/types'
import { STAGE_INFO } from '@shared/domain/activity'
import { screenAt, screenLE, type ScreenRef } from '@shared/domain/lesson'
import type { NoticeMessage, StudentSnapshot } from '@shared/protocol/messages'
import { useLesson, LoadingScreen } from '../data/useLesson'
import type { LessonData } from '../data/lesson'
import { emptyDraft, makeRevision, reducer, type InquiryState } from '../inquiry/engine'
import { loadRoomInfo, loadRoomRecord, saveRoomRecord } from '../inquiry/localStore'
import { LessonShell } from '../lesson/LessonShell'
import { RoomClient, type ConnectionState } from '../realtime/RoomClient'
import { api, ApiError } from '../realtime/api'
import { TopBar } from '../ui/TopBar'
import { useToast } from '../ui/Toast'
import type { RoomContext } from '../workspace/Workspace'
import { audio } from '../audio/AudioManager'
import { Button } from '../ui/Button'

export default function Room() {
  const { id } = useParams()
  const code = (id ?? '').toUpperCase()
  const { data, error, progress, retry } = useLesson()
  const [snap, setSnap] = useState<StudentSnapshot | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    api.me(code).then((s) => { if (alive) setSnap(s) }).catch((e) => { if (alive) setAuthError(e instanceof ApiError ? e.message : '입장 정보를 확인하지 못했습니다.') })
    return () => { alive = false }
  }, [code])
  if (authError) {
    return (
      <div className="page page-narrow">
        <TopBar />
        <div className="card stack">
          <h1 style={{ fontSize: 22 }}>탐사실에 들어갈 수 없습니다</h1>
          <p className="error-text">{authError}</p>
          <p className="muted small">이 기기의 입장 정보가 없거나 만료되었습니다. 코드와 별명으로 다시 입장하세요. 이전 기록이 서버에 남아 있으면 선생님 화면에서 확인할 수 있습니다.</p>
          <Link className="btn btn-primary" to={`/join?code=${code}`}>다시 입장하기</Link>
        </div>
      </div>
    )
  }
  if (!data || !snap) return <LoadingScreen progress={progress} error={error} onRetry={retry} title={snap ? '관측 자료를 준비하는 중' : '탐사실에 연결하는 중'} />
  return <RoomInner code={code} data={data} initial={snap} />
}

function RoomInner({ code, data, initial }: { code: string; data: LessonData; initial: StudentSnapshot }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(reducer, initial, (s): InquiryState => ({
    record: { ...(loadRoomRecord(code) ?? s.record), ...s.record },
    draft: emptyDraft('freehand'),
    submit: { kind: null, status: 'idle', message: null },
  }))
  const [snap, setSnap] = useState<StudentSnapshot>(initial)
  const [conn, setConn] = useState<ConnectionState>('idle')
  const [queued, setQueued] = useState(0)
  const [closed, setClosed] = useState<{ code: number; reason: string } | null>(null)
  const [screen, setScreen] = useState<ScreenRef>(initial.room.screen)
  const [following, setFollowing] = useState(true)
  const clientRef = useRef<RoomClient | null>(null)
  const local = loadRoomInfo(code)

  // 스냅샷은 통째로 받아들인다. 내 기록은 서버 사본이 권위, 작성 중인 초안은 유지.
  const applySnapshot = useCallback((s: StudentSnapshot) => {
    setSnap(s)
    dispatch({ type: 'record/replace', record: s.record as InquiryRecord })
    saveRoomRecord(code, s.record)
  }, [code])

  // 선생님 화면 따라가기 (입력 중이면 뺏지 않는다: 활동 화면은 각자 속도)
  const teacherScreen = snap.room.screen
  useEffect(() => {
    if (!following) return
    if (screen.step === teacherScreen.step && screen.sub === teacherScreen.sub) return
    setScreen(teacherScreen)
    window.scrollTo({ top: 0 })
  }, [teacherScreen, following]) // screen은 의도적으로 제외: 따라가기 중일 때만 교사 화면을 적용

  useEffect(() => {
    const client = new RoomClient({
      code, as: 'student',
      onSnapshot: (s) => { if (s.role === 'student') applySnapshot(s) },
      onNotice: (n: NoticeMessage) => {
        if (n.code === 'screenChanged' || n.code === 'stageChanged') { toast.push(n.message); void audio.play('gentle-attention') }
        else if (n.code === 'reveal') { toast.push(n.message); void audio.play('gentle-attention') }
        else if (n.code === 'removed' || n.code === 'ended' || n.code === 'expired' || n.code === 'deleted') toast.push(n.message, 'danger')
        else toast.push(n.message)
      },
      onState: (s) => { setConn(s); setQueued(client.queuedCount) },
      onClosedForGood: (c, r) => setClosed({ code: c, reason: r }),
    })
    clientRef.current = client
    client.connect()
    const t = setInterval(() => setQueued(client.queuedCount), 1000)
    return () => { clearInterval(t); client.close(); clientRef.current = null }
  }, [code, applySnapshot, toast])

  const send = useCallback(async (msg: Parameters<RoomClient['send']>[0], onQueued?: () => void) => {
    const c = clientRef.current
    if (!c) throw new Error('연결이 없습니다')
    return c.send(msg, onQueued)
  }, [])

  const onSubmit = useCallback(async (kind: GuessKind) => {
    const rev = makeRevision(kind, state.draft, data.datasetVersion)
    dispatch({ type: 'submit/start', kind })
    try {
      const ack = await send({ type: 'submitGuess', kind, guess: rev.guess, idempotencyKey: rev.idempotencyKey, datasetVersion: rev.datasetVersion }, () => dispatch({ type: 'submit/queued', kind }))
      if (ack.ok) {
        dispatch({ type: 'submit/saved', revision: rev })
        void audio.play('submit-confirm')
        toast.push(ack.duplicate ? '이미 저장된 제출입니다.' : (kind === 'first' ? '최초 추론이 서버에 저장되었습니다.' : '수정 추론이 서버에 저장되었습니다.'), 'success')
      } else {
        dispatch({ type: 'submit/error', message: ack.error?.message ?? '저장하지 못했습니다.' })
        toast.push(ack.error?.message ?? '저장하지 못했습니다.', 'danger')
      }
    } catch (e) {
      dispatch({ type: 'submit/error', message: e instanceof Error ? e.message : '전송에 실패했습니다.' })
    }
  }, [state.draft, data.datasetVersion, send, toast])

  const onScreen = useCallback((ref: ScreenRef) => {
    if (!screenLE(ref, snap.room.screen)) return
    setScreen(ref)
    dispatch({ type: 'submit/reset' })
    // 직접 다른 화면으로 가면 따라가기는 잠시 꺼지고, 다시 켜면 합류한다
    if (ref.step !== teacherScreen.step || ref.sub !== teacherScreen.sub) setFollowing(false)
  }, [snap.room.screen, teacherScreen])

  const evidenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onEvidenceChange = useCallback((list: Evidence[]) => {
    if (evidenceTimer.current) clearTimeout(evidenceTimer.current)
    evidenceTimer.current = setTimeout(() => {
      send({ type: 'saveEvidence', evidence: list }).then((ack) => { if (!ack.ok) toast.push(ack.error?.message ?? '증거 저장 실패', 'danger') }).catch(() => { /* 재연결 시 재전송 */ })
    }, 800)
  }, [send, toast])

  const onResponses = useCallback((responses: NonNullable<InquiryRecord['responses']>) => {
    send({ type: 'saveResponses', responses }).then((ack) => { if (!ack.ok) toast.push(ack.error?.message ?? '응답 저장 실패', 'danger') }).catch(() => { /* 재연결 시 재전송 */ })
  }, [send, toast])

  const onExplanation = useCallback((text: string, limitations: string) => {
    send({ type: 'saveExplanation', explanation: { text, limitations } }).then((ack) => {
      if (ack.ok) dispatch({ type: 'explanation/set', text, limitations })
      toast.push(ack.ok ? '서버에 저장되었습니다.' : (ack.error?.message ?? '저장 실패'), ack.ok ? 'success' : 'danger')
    }).catch(() => toast.push('저장하지 못했습니다. 작성한 내용은 유지됩니다. 연결을 확인한 뒤 다시 저장해 주세요.', 'danger'))
  }, [send, toast])

  const room: RoomContext = { meta: snap.room, sharedGuesses: snap.sharedGuesses, highlighted: [], connection: conn, queued, participantCount: snap.participantCount, myParticipantId: snap.me.id }
  const def = screenAt(screen.step, screen.sub)

  if (closed) {
    const msg = closed.code === 4001 ? '탐사실 보관 기간이 끝나 접속이 닫혔습니다.' : closed.code === 4003 ? '선생님이 탐사실을 삭제했습니다.' : closed.code === 4004 ? '선생님이 탐사실에서 내보냈습니다.' : '탐사실이 종료되어 접속이 닫혔습니다.'
    return (
      <div className="page page-narrow">
        <TopBar />
        <div className="card stack">
          <h1 style={{ fontSize: 22 }}>{msg}</h1>
          <p className="muted small">이 기기에 남은 임시 사본으로 개인 결과를 볼 수 있습니다. 서버 사본은 탐사실 정책에 따라 정리됩니다.</p>
          <div className="row">
            <Button variant="primary" onClick={() => navigate(`/report/${code}?p=${snap.me.id}&local=1`)}>내 탐구 카드 보기</Button>
            <Link className="btn btn-secondary" to="/">처음으로</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <TopBar center={<span className="status-pill"><strong>{snap.room.title}</strong> · {def?.title ?? STAGE_INFO[snap.room.stage].short} · {local?.nickname ?? snap.me.nickname}</span>} />
      <LessonShell role="student" data={data} state={state} dispatch={dispatch} screen={screen} onScreen={onScreen} maxScreen={snap.room.screen}
        following={following} onFollow={(v) => { setFollowing(v); if (v) setScreen(snap.room.screen) }}
        room={room} onSubmit={(k) => void onSubmit(k)} onEvidenceChange={onEvidenceChange} onExplanation={onExplanation} onResponses={onResponses}
        startRegion={snap.room.startRegion} reportHref={`/report/${code}?p=${snap.me.id}`} nickname={snap.me.nickname} />
    </>
  )
}
