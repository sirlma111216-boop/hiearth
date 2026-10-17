// 교사 진행·발표·결과 화면.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import type { Stage, ViewState, MapMode, InquiryRecord, ParticipantPublic } from '@shared/domain/types'
import { STAGES } from '@shared/domain/types'
import { STAGE_INFO, checklist } from '@shared/domain/activity'
import { formatKst } from '@shared/geo/time'
import type { TeacherSnapshot, NoticeMessage } from '@shared/protocol/messages'
import { useLesson, LoadingScreen } from '../data/useLesson'
import type { LessonData } from '../data/lesson'
import { emptyDraft, reducer, type InquiryState } from '../inquiry/engine'
import { emptyRecord } from '@shared/domain/activity'
import { forgetTeacherRoom } from '../inquiry/localStore'
import { RoomClient, type ConnectionState } from '../realtime/RoomClient'
import { api, ApiError } from '../realtime/api'
import { TopBar } from '../ui/TopBar'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { Workspace, type RoomContext } from '../workspace/Workspace'
import { audio } from '../audio/AudioManager'

type Tab = 'lobby' | 'run' | 'results'

export default function TeachRoom() {
  const { id } = useParams()
  const code = (id ?? '').toUpperCase()
  const { data, error, progress, retry } = useLesson()
  const [snap, setSnap] = useState<TeacherSnapshot | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    api.teacherState(code).then((s) => { if (alive) setSnap(s) }).catch((e) => { if (alive) setAuthError(e instanceof ApiError ? e.message : '교사 권한을 확인하지 못했습니다.') })
    return () => { alive = false }
  }, [code])
  if (authError) {
    return (
      <div className="page page-narrow"><TopBar />
        <div className="card stack"><h1 style={{ fontSize: 22 }}>교사 화면을 열 수 없습니다</h1><p className="error-text">{authError}</p>
          <p className="muted small">이 기기에 교사 세션이 없습니다. 탐사실을 만든 기기에서 열거나, 복구 코드로 복구하세요.</p>
          <Link to="/teach" className="btn btn-primary">교사 페이지로</Link></div></div>
    )
  }
  if (!data || !snap) return <LoadingScreen progress={progress} error={error} onRetry={retry} title="교사 화면을 준비하는 중" />
  return <TeachRoomInner code={code} data={data} initial={snap} />
}

function TeachRoomInner({ code, data, initial }: { code: string; data: LessonData; initial: TeacherSnapshot }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [snap, setSnap] = useState<TeacherSnapshot>(initial)
  const [conn, setConn] = useState<ConnectionState>('idle')
  const [tab, setTab] = useState<Tab>(initial.participants.length ? 'run' : 'lobby')
  const [presentation, setPresentation] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [groupFilter, setGroupFilter] = useState<string>('')
  const [records, setRecords] = useState<{ participant: ParticipantPublic; record: InquiryRecord }[] | null>(null)
  const clientRef = useRef<RoomClient | null>(null)
  const joinUrl = `${location.origin}/join?code=${code}`
  // 교사 화면의 지도 상태용 더미 엔진 (그리기 없음)
  const [wsState, wsDispatch] = useReducer(reducer, undefined, (): InquiryState => ({ record: { ...emptyRecord(data.datasetVersion), stage: initial.room.stage }, draft: emptyDraft(), submit: { kind: null, status: 'idle', message: null } }))

  useEffect(() => { QRCode.toDataURL(joinUrl, { width: 440, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#071b20', light: '#ffffff' } }).then(setQr).catch(() => setQr(null)) }, [joinUrl])

  useEffect(() => {
    const client = new RoomClient({
      code, as: 'teacher',
      onSnapshot: (s) => { if (s.role === 'teacher') { setSnap(s); wsDispatch({ type: 'setStage', stage: s.room.stage }) } },
      onNotice: (n: NoticeMessage) => toast.push(n.message),
      onState: setConn,
      onClosedForGood: (_c, r) => toast.push('연결이 종료되었습니다: ' + r, 'danger'),
    })
    clientRef.current = client
    client.connect()
    return () => { client.close(); clientRef.current = null }
  }, [code, toast])

  useEffect(() => {
    if (!presentation) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPresentation(false) }
    document.addEventListener('keydown', onKey)
    document.documentElement.requestFullscreen?.().catch(() => { /* 전체화면 거부는 무시 */ })
    return () => { document.removeEventListener('keydown', onKey); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => { /* noop */ }) }
  }, [presentation])

  const send = useCallback(async (msg: Parameters<RoomClient['send']>[0]) => {
    const c = clientRef.current
    if (!c) return
    try {
      const ack = await c.send(msg)
      if (!ack.ok) toast.push(ack.error?.message ?? '처리되지 않았습니다.', 'danger')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : '전송 실패', 'danger')
    }
  }, [toast])

  const setStage = (s: Stage) => { void send({ type: 'teacher:setStage', stage: s }); void audio.play('ui-tap') }
  const room = snap.room
  const visibleParticipants = useMemo(() => snap.participants.filter((p) => !groupFilter || p.group === groupFilter), [snap.participants, groupFilter])
  const roomCtx: RoomContext = { meta: room, sharedGuesses: groupFilter ? snap.sharedGuesses.filter((g) => g.group === groupFilter) : snap.sharedGuesses, highlighted: snap.highlighted, connection: conn, queued: 0, participantCount: snap.participants.length, myParticipantId: null }
  const counts = { first: snap.participants.filter((p) => p.hasFirst).length, revised: snap.participants.filter((p) => p.hasRevised).length, explanation: snap.participants.filter((p) => p.hasExplanation).length, online: snap.participants.filter((p) => p.connected).length }

  const loadRecords = async () => { try { const r = await api.teacherRecords(code); setRecords(r.records) } catch (e) { toast.push(e instanceof ApiError ? e.message : '결과를 받지 못했습니다.', 'danger') } }
  useEffect(() => { if (tab === 'results') void loadRecords() }, [tab, snap.roomRevision])

  const toggleHighlight = (id: string) => {
    const cur = snap.highlighted
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2)
    void send({ type: 'teacher:highlight', participantIds: next })
  }

  const deleteRoom = async () => {
    try { await api.deleteRoom(code); forgetTeacherRoom(code); toast.push('탐사실을 삭제했습니다.'); navigate('/teach') } catch (e) { toast.push(e instanceof ApiError ? e.message : '삭제 실패', 'danger') }
  }

  const side = (
    <aside className="teach-side">
      <div className="row between">
        <div><div className="eyebrow">Room {code}</div><strong>{room.title}</strong></div>
        <span className="status-pill"><span className={'dot ' + (conn === 'open' ? 'dot-on' : conn === 'reconnecting' ? 'dot-warn' : 'dot-off')} />{conn === 'open' ? '연결됨' : conn === 'reconnecting' ? '재연결 중' : '연결 끊김'}</span>
      </div>
      <div className="row" role="tablist" aria-label="교사 화면 탭">
        {(['lobby', 'run', 'results'] as Tab[]).map((t) => <Button key={t} size="sm" variant="quiet" active={tab === t} onClick={() => setTab(t)} role="tab" aria-selected={tab === t}>{t === 'lobby' ? '대기실·QR' : t === 'run' ? '진행' : '결과'}</Button>)}
      </div>
      <div className="tiny muted num">만료 {formatKst(room.expiresAt)} · 만료 전 결과를 내려받으세요 · 상태 {room.status === 'open' ? '진행 중' : '종료'}</div>

      <section className="stack" style={{ gap: 6 }}>
        <div className="label">활동 단계</div>
        <div className="stage-list">
          {STAGES.map((s) => { const i = STAGE_INFO[s]; const cur = room.stage === s; const done = STAGE_INFO[room.stage].index > i.index; return (
            <button key={s} type="button" className={'stage-item' + (cur ? ' is-current' : done ? ' is-done' : '')} onClick={() => setStage(s)} aria-current={cur ? 'step' : undefined} disabled={room.status !== 'open'}>
              <span className="n">{i.index + 1}</span><span>{i.short} · <span className="tiny muted">{i.title}</span></span>
            </button>) })}
        </div>
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <div className="label">공개·잠금</div>
        <div className="row">
          <Button size="sm" icon={room.revealed.firstGuesses ? 'eye' : 'eyeOff'} active={room.revealed.firstGuesses} onClick={() => send({ type: 'teacher:reveal', what: 'firstGuesses', value: !room.revealed.firstGuesses })} disabled={room.status !== 'open'}>추론 일괄 공개</Button>
          <Button size="sm" icon="volcano" active={room.revealed.volcanoes} onClick={() => send({ type: 'teacher:reveal', what: 'volcanoes', value: !room.revealed.volcanoes })} disabled={room.status !== 'open'}>화산</Button>
          <Button size="sm" icon="plate" active={room.revealed.boundaries} onClick={() => send({ type: 'teacher:reveal', what: 'boundaries', value: !room.revealed.boundaries })} disabled={room.status !== 'open'}>판 경계</Button>
          <Button size="sm" icon="users" active={room.revealed.nicknames} onClick={() => send({ type: 'teacher:reveal', what: 'nicknames', value: !room.revealed.nicknames })} disabled={room.status !== 'open'}>별명 공개</Button>
        </div>
        <div className="row">
          <Button size="sm" icon={room.inputLocked ? 'lock' : 'unlock'} active={room.inputLocked} onClick={() => send({ type: 'teacher:lockInput', locked: !room.inputLocked })} disabled={room.status !== 'open'}>{room.inputLocked ? '입력 잠김' : '입력 열림'}</Button>
          <Button size="sm" icon={room.joinLocked ? 'lock' : 'unlock'} active={room.joinLocked} onClick={() => send({ type: 'teacher:lockJoin', locked: !room.joinLocked })} disabled={room.status !== 'open'}>{room.joinLocked ? '입장 잠김' : '입장 열림'}</Button>
          {room.followView ? <Button size="sm" variant="quiet" icon="close" onClick={() => send({ type: 'teacher:clearSyncView' })}>따라가기 해제</Button> : null}
        </div>
      </section>

      <section className="stack" style={{ gap: 6 }}>
        <div className="row between">
          <div className="label">참가 <span className="num">{snap.participants.length}/{room.maxParticipants}</span> · 접속 <span className="num">{counts.online}</span></div>
          {room.groups.length ? <select className="select" style={{ width: 'auto', minHeight: 36, fontSize: 13, padding: '2px 8px' }} value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label="모둠 필터"><option value="">모든 모둠</option>{room.groups.map((g) => <option key={g} value={g}>{g}</option>)}</select> : null}
        </div>
        <div className="tiny muted num">최초 추론 {counts.first} · 수정 추론 {counts.revised} · 설명 작성 {counts.explanation}</div>
        <div className="participant-list">
          {visibleParticipants.map((p) => (
            <div key={p.id} className={'participant' + (p.connected ? '' : ' is-off') + (snap.highlighted.includes(p.id) ? ' is-hl' : '')}>
              <span className={'dot ' + (p.connected ? 'dot-on' : 'dot-off')} aria-label={p.connected ? '접속 중' : '이탈'} />
              <button type="button" className="btn btn-quiet btn-sm" style={{ padding: '2px 6px', minHeight: 28 }} onClick={() => toggleHighlight(p.id)} title="비교 강조 (최대 2명)" aria-pressed={snap.highlighted.includes(p.id)}>{p.nickname}</button>
              {p.group ? <span className="tiny muted">{p.group}</span> : null}
              <span className="flags" aria-label="제출 현황">
                <span className={'flag' + (p.hasFirst ? ' on' : '')} title="최초 추론">1</span>
                <span className={'flag' + (p.hasRevised ? ' on' : '')} title="수정 추론">2</span>
                <span className={'flag' + (p.evidenceCount ? ' on' : '')} title="증거">E</span>
                <span className={'flag' + (p.hasExplanation ? ' on' : '')} title="설명">W</span>
              </span>
              {room.groups.length ? <select className="select" style={{ width: 'auto', minHeight: 28, fontSize: 12, padding: '0 4px' }} value={p.group ?? ''} onChange={(e) => send({ type: 'teacher:assignGroup', participantId: p.id, group: e.target.value || null })} aria-label={`${p.nickname} 모둠 지정`}><option value="">-</option>{room.groups.map((g) => <option key={g} value={g}>{g}</option>)}</select> : null}
              <button type="button" className="btn btn-quiet btn-sm" style={{ padding: 2, minHeight: 28 }} onClick={() => { if (confirm(`${p.nickname} 님을 내보낼까요? 이 참가자의 접속이 끊기고 다시 입장해야 합니다.`)) void send({ type: 'teacher:remove', participantId: p.id }) }} aria-label={`${p.nickname} 내보내기`} title="내보내기"><Icon name="close" /></button>
            </div>
          ))}
          {!visibleParticipants.length ? <span className="hint">아직 참가자가 없습니다. 대기실의 QR을 보여 주세요.</span> : null}
        </div>
      </section>

      <section className="stack" style={{ gap: 6 }}>
        <div className="label">결과·종료</div>
        <div className="row">
          <a className="btn btn-sm btn-secondary" href={api.exportUrl(code, 'csv')} download><Icon name="download" /> CSV</a>
          <a className="btn btn-sm btn-secondary" href={api.exportUrl(code, 'json')} download><Icon name="download" /> JSON</a>
          <Button size="sm" variant="secondary" icon="expand" onClick={() => { setTab('run'); setPresentation(true) }}>전체화면 발표</Button>
        </div>
        <div className="row">
          {room.status === 'open' ? <Button size="sm" variant="secondary" icon="stop" onClick={() => setConfirmEnd(true)}>탐사실 종료</Button> : null}
          <Button size="sm" variant="destructive" icon="trash" onClick={() => setConfirmDelete(true)}>삭제</Button>
        </div>
      </section>
    </aside>
  )

  return (
    <>
      {!presentation ? <TopBar center={<span className="status-pill"><strong>교사</strong> · {room.title} · {STAGE_INFO[room.stage].short}</span>} /> : null}
      <div className={presentation ? '' : 'teach-layout'}>
        {!presentation ? side : null}
        <main className="teach-main">
          {tab === 'lobby' && !presentation ? (
            <div className="lobby" style={{ minHeight: 'auto', padding: 32 }}>
              <div className="lobby-bg" aria-hidden="true"><img src="/images/lobby-observatory.webp" alt="" /></div>
              <div className="stack" style={{ gap: 18 }}>
                <span className="eyebrow">Scan to Join</span>
                <div className="room-code" aria-label={`입장 코드 ${code.split('').join(' ')}`}>{code}</div>
                <div className="qr-card">{qr ? <img src={qr} alt={`입장 QR 코드: ${joinUrl}`} /> : <div style={{ width: 220, height: 220 }} />}<span className="tiny" style={{ color: '#333' }}>{location.host}/join</span></div>
                <p className="muted">학생은 카메라로 QR을 찍거나 <strong>{location.host}/join</strong> 에서 코드를 입력합니다. 별명만 적으면 됩니다.</p>
                <div className="row"><Button size="sm" variant="secondary" icon="copy" onClick={() => navigator.clipboard?.writeText(joinUrl).then(() => toast.push('입장 링크를 복사했습니다.'))}>입장 링크 복사</Button><Button size="sm" variant="primary" iconRight="arrowRight" onClick={() => setTab('run')}>진행 화면으로</Button></div>
                <p className="tiny muted">참가 {snap.participants.length}명 · 공개 링크에는 교사 권한 값이 들어 있지 않습니다.</p>
              </div>
              <div aria-hidden="true" />
            </div>
          ) : tab === 'results' && !presentation ? (
            <ResultsTable records={records} room={room} code={code} onReload={loadRecords} />
          ) : (
            <Workspace data={data} state={wsState} dispatch={wsDispatch} role="teacher" room={roomCtx} onSubmit={() => {}} onStage={setStage}
              onExplanation={() => {}} startRegion={room.startRegion} presentation={presentation} onPresentation={setPresentation}
              onShareView={(view: ViewState, mode: MapMode, force: boolean) => { void send({ type: 'teacher:syncView', view, mode, force }); toast.push(force ? '모든 학생의 지도를 이곳으로 이동시켰습니다.' : '따라가기를 켠 학생에게 조건을 공유했습니다.') }} />
          )}
        </main>
      </div>
      <Dialog open={confirmEnd} title="탐사실을 종료할까요?" onClose={() => setConfirmEnd(false)} actions={<><Button variant="secondary" onClick={() => setConfirmEnd(false)}>취소</Button><Button variant="primary" onClick={() => { setConfirmEnd(false); void send({ type: 'teacher:end' }) }}>종료</Button></>}>
        <p className="muted">학생의 제출이 막히고 활동이 '결과 정리'로 바뀝니다. 기록은 만료 시각({formatKst(room.expiresAt)})까지 남아 결과를 내려받을 수 있습니다.</p>
      </Dialog>
      <Dialog open={confirmDelete} title="탐사실을 삭제할까요?" onClose={() => setConfirmDelete(false)} actions={<><Button variant="secondary" onClick={() => setConfirmDelete(false)}>취소</Button><Button variant="destructive" icon="trash" onClick={() => { setConfirmDelete(false); void deleteRoom() }}>영구 삭제</Button></>}>
        <p className="muted">영향 범위: 참가자 {snap.participants.length}명의 추론·증거·설명, 교사 세션과 복구 코드가 서버에서 즉시 삭제되고 모든 접속이 끊깁니다. 되돌릴 수 없습니다. 학생 기기의 로컬 사본은 별개입니다.</p>
        <p className="muted small">삭제 전에 CSV/JSON을 내려받으세요.</p>
      </Dialog>
    </>
  )
}

function ResultsTable({ records, room, code, onReload }: { records: { participant: ParticipantPublic; record: InquiryRecord }[] | null; room: TeacherSnapshot['room']; code: string; onReload: () => void }) {
  return (
    <div className="page" style={{ paddingTop: 24 }}>
      <div className="row between" style={{ marginBottom: 16 }}>
        <div><span className="eyebrow">Results</span><h1 style={{ fontSize: 24 }}>{room.title} · 결과</h1></div>
        <div className="row"><Button size="sm" variant="quiet" icon="refresh" onClick={onReload}>새로고침</Button><a className="btn btn-sm btn-secondary" href={api.exportUrl(code, 'csv')} download>CSV</a><a className="btn btn-sm btn-secondary" href={api.exportUrl(code, 'json')} download>JSON</a></div>
      </div>
      <p className="muted small" style={{ marginBottom: 12 }}>체크리스트는 서열화가 아니라 살펴볼 지점입니다. 설명의 과학적 정확도는 자동 판정하지 않습니다. 자동 통계는 제출·수정·작성 여부처럼 확인 가능한 값만 표시합니다.</p>
      {!records ? <p className="muted">불러오는 중…</p> : (
        <table className="data">
          <thead><tr><th>별명</th><th>모둠</th><th>최초 추론</th><th>수정 추론</th><th>증거</th><th>관찰 근거</th><th>화산 고려</th><th>설명 수정</th><th>한계 작성</th><th>보고서</th></tr></thead>
          <tbody>
            {records.map(({ participant: p, record: r }) => { const c = checklist(r); const Y = (v: boolean) => <span className={'flag' + (v ? ' on' : '')} style={{ display: 'inline-grid' }}>{v ? '✓' : '·'}</span>; return (
              <tr key={p.id}>
                <td>{p.nickname}</td><td>{p.group ?? '-'}</td>
                <td className="num">{r.firstGuess ? `선 ${r.firstGuess.guess.lines.length} · ${formatKst(r.firstGuess.submittedAt).slice(0, 16)}` : '-'}</td>
                <td className="num">{r.revisedGuess ? `선 ${r.revisedGuess.guess.lines.length}` : '-'}</td>
                <td className="num">{r.evidence.length}</td>
                <td>{Y(c.hasObservationEvidence)}</td><td>{Y(c.consideredVolcanoes)}</td><td>{Y(c.revisedExplanation)}</td><td>{Y(c.wroteLimitations)}</td>
                <td><Link to={`/report/${code}?p=${p.id}`}>열기</Link></td>
              </tr>) })}
          </tbody>
        </table>
      )}
    </div>
  )
}
