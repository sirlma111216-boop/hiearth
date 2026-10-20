// 탐사실을 만든 브라우저에만 교사 세션을 발급한다.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { RoomSettings } from '@shared/domain/types'
import { REGION_PRESETS } from '@shared/domain/presets'
import { DATASETS, DEFAULT_DATASET } from '@shared/domain/presets'
import { api, ApiError } from '../realtime/api'
import { TopBar } from '../ui/TopBar'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { listTeacherRooms, rememberTeacherRoom } from '../inquiry/localStore'
import { formatKst } from '@shared/geo/time'

export default function Teach() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('지진과 화산, 판의 경계 찾기')
  const [region, setRegion] = useState('world')
  const [max, setMax] = useState(40)
  const [hours, setHours] = useState(24)
  const [groups, setGroups] = useState('1모둠, 2모둠, 3모둠, 4모둠, 5모둠, 6모둠')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ code: string; recoveryToken: string; expiresAt: number } | null>(null)
  const [recoverCode, setRecoverCode] = useState('')
  const [recoverToken, setRecoverToken] = useState('')
  const rooms = listTeacherRooms()

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    const settings: RoomSettings = {
      title: title.trim() || '지구 탐사대',
      datasetId: DEFAULT_DATASET,
      startRegion: region,
      maxParticipants: Math.min(60, Math.max(1, max)),
      ttlMs: Math.min(24, Math.max(1, hours)) * 3600 * 1000,
      groups: groups.split(',').map((g) => g.trim()).filter(Boolean).slice(0, 12),
    }
    try {
      const r = await api.createRoom(settings)
      rememberTeacherRoom({ code: r.code, title: settings.title, createdAt: r.meta.createdAt, expiresAt: r.meta.expiresAt })
      setCreated({ code: r.code, recoveryToken: r.recoveryToken, expiresAt: r.meta.expiresAt })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '탐사실을 만들지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const recover = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await api.recover(recoverCode.toUpperCase(), recoverToken.trim())
      rememberTeacherRoom({ code: r.code, title: r.meta.title, createdAt: r.meta.createdAt, expiresAt: r.meta.expiresAt })
      navigate(`/teach/${r.code}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '복구하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <TopBar />
      <div className="stack" style={{ gap: 24 }}>
        <div>
          <span className="eyebrow">For Teachers</span>
          <h1 style={{ fontSize: 32, marginTop: 8 }}>탐사실 만들기</h1>
          <p className="muted" style={{ marginTop: 8 }}>탐사실을 만들면 입장 코드와 QR이 생깁니다. 학생은 가입 없이 별명으로 들어옵니다. 기록은 생성 후 설정한 시간(최대 24시간) 동안 보관됩니다.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          <form className="card stack" onSubmit={create} style={{ gap: 14 }}>
            <h2 style={{ fontSize: 20 }}>새 탐사실</h2>
            <div className="field"><label htmlFor="t-title">활동 제목</label><input id="t-title" className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} /></div>
            <div className="field"><label htmlFor="t-ds">사용 자료 묶음</label>
              <select id="t-ds" className="select" value={DEFAULT_DATASET} disabled>{DATASETS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select>
              <span className="hint">최근 자료는 활동 중 학생이 증거 서랍에서 추가로 볼 수 있습니다.</span></div>
            <div className="field"><label htmlFor="t-region">시작 지역</label>
              <select id="t-region" className="select" value={region} onChange={(e) => setRegion(e.target.value)}>{REGION_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
            <div className="row">
              <div className="field grow"><label htmlFor="t-max">참여 상한</label><input id="t-max" className="input num" type="number" min={1} max={60} value={max} onChange={(e) => setMax(Number(e.target.value))} /></div>
              <div className="field grow"><label htmlFor="t-hours">보관 시간</label><input id="t-hours" className="input num" type="number" min={1} max={24} value={hours} onChange={(e) => setHours(Number(e.target.value))} /></div>
            </div>
            <div className="field"><label htmlFor="t-groups">모둠 목록 (쉼표로 구분, 비우면 모둠 없음)</label><input id="t-groups" className="input" value={groups} onChange={(e) => setGroups(e.target.value)} /></div>
            <p className="hint">탐사실을 만든 브라우저에 교사 권한이 저장됩니다. 학생에게는 입장 코드나 링크를 공유하세요.</p>
            {error ? <p className="error-text" role="alert">{error}</p> : null}
            <Button type="submit" variant="primary" size="lg" loading={busy}>탐사실 만들기</Button>
          </form>
          <div className="stack" style={{ gap: 20 }}>
            {rooms.length ? (
              <div className="card stack">
                <h2 style={{ fontSize: 18 }}>이 기기에서 만든 탐사실</h2>
                {rooms.map((r) => (
                  <Link key={r.code} to={`/teach/${r.code}`} className="stage-item"><span className="n">▶</span><span className="grow">{r.title} · <span className="num">{r.code}</span><br /><span className="tiny muted">만료 {formatKst(r.expiresAt)}</span></span></Link>
                ))}
              </div>
            ) : null}
            <form className="card stack" onSubmit={recover}>
              <h2 style={{ fontSize: 18 }}>다른 기기에서 교사 화면 복구</h2>
              <p className="hint">탐사실을 만들 때 받은 복구 코드를 입력하면 이 기기에서도 교사 권한으로 들어갑니다.</p>
              <div className="field"><label htmlFor="r-code">입장 코드</label><input id="r-code" className="input num" value={recoverCode} maxLength={6} onChange={(e) => setRecoverCode(e.target.value.toUpperCase())} /></div>
              <div className="field"><label htmlFor="r-token">복구 코드</label><input id="r-token" className="input" type="password" value={recoverToken} onChange={(e) => setRecoverToken(e.target.value)} /></div>
              <Button type="submit" variant="secondary" loading={busy} disabledReason={recoverCode.length !== 6 || !recoverToken ? '코드와 복구 코드를 입력하세요' : undefined}>복구하기</Button>
            </form>
          </div>
        </div>
      </div>
      <Dialog open={!!created} title="탐사실이 준비되었습니다" onClose={() => created && navigate(`/teach/${created.code}`)} actions={<Button variant="primary" onClick={() => created && navigate(`/teach/${created.code}`)} iconRight="arrowRight">대기실로 이동</Button>}>
        {created ? (
          <>
            <p>입장 코드 <strong className="num" style={{ fontSize: 24, letterSpacing: '0.15em' }}>{created.code}</strong></p>
            <p className="muted small">만료: {formatKst(created.expiresAt)}. 만료 후에는 서버 기록이 삭제되므로 결과를 미리 내려받으세요.</p>
            <div className="field">
              <label htmlFor="t-recovery">교사 복구 코드 (지금 한 번만 표시됩니다)</label>
              <input id="t-recovery" className="input num" readOnly value={created.recoveryToken} onFocus={(e) => e.currentTarget.select()} />
              <span className="hint">다른 기기에서 교사 화면을 열 때 필요합니다. 학생과 공유하지 마세요. 이 코드는 서버에 해시로만 저장됩니다.</span>
            </div>
          </>
        ) : null}
      </Dialog>
    </div>
  )
}
