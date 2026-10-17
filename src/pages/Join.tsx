import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MAX_NICKNAME } from '@shared/domain/types'
import { sanitizeNickname } from '@shared/domain/schemas'
import { api, ApiError, type RoomInfo } from '../realtime/api'
import { TopBar } from '../ui/TopBar'
import { Button } from '../ui/Button'
import { saveRoomInfo, listRoomInfos } from '../inquiry/localStore'
import { audio } from '../audio/AudioManager'

export default function Join() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [code, setCode] = useState((params.get('code') ?? '').toUpperCase())
  const [nickname, setNickname] = useState('')
  const [group, setGroup] = useState<string>('')
  const [info, setInfo] = useState<RoomInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const recent = listRoomInfos()

  useEffect(() => {
    const c = code.trim().toUpperCase()
    if (c.length !== 6) { setInfo(null); return }
    let alive = true
    setChecking(true); setError(null)
    api.roomInfo(c).then((i) => { if (alive) setInfo(i) }).catch((e) => { if (alive) { setInfo(null); setError(e instanceof ApiError ? e.message : '탐사실을 확인하지 못했습니다.') } }).finally(() => alive && setChecking(false))
    return () => { alive = false }
  }, [code])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const c = code.trim().toUpperCase()
    const nick = sanitizeNickname(nickname)
    if (!nick) { setError(`별명은 1~${MAX_NICKNAME}자이며 특수문자를 쓸 수 없습니다.`); return }
    setJoining(true); setError(null)
    try {
      const r = await api.join(c, nick, group || null)
      saveRoomInfo({ code: c, participantId: r.participantId, nickname: r.nickname, joinedAt: Date.now(), title: info?.title })
      void audio.play('enter-expedition')
      navigate(`/room/${c}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '입장하지 못했습니다.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="lobby">
      <TopBar />
      <div className="lobby-bg" aria-hidden="true">
        <picture>
          <source type="image/avif" srcSet="/images/lobby-observatory.avif" />
          <source type="image/webp" srcSet="/images/lobby-observatory.webp" />
          <img src="/images/lobby-observatory.png" alt="" />
        </picture>
      </div>
      <form className="card stack" onSubmit={submit} style={{ gap: 16 }} aria-labelledby="join-title">
        <span className="eyebrow">Join Expedition</span>
        <h1 id="join-title" style={{ fontSize: 28 }}>탐사실 입장</h1>
        <p className="muted">선생님이 보여 준 6자 코드와 별명만 입력하면 됩니다. 실명·학번·이메일은 필요 없습니다.</p>
        <div className="field">
          <label htmlFor="code">입장 코드</label>
          <input id="code" className="input num" style={{ fontSize: 24, letterSpacing: '0.2em', textTransform: 'uppercase' }} value={code} maxLength={6} autoComplete="off" inputMode="text" placeholder="ABC234" onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} aria-describedby="code-status" />
          <span id="code-status" className="hint" aria-live="polite">
            {checking ? '확인 중…' : info ? `${info.title} · 참가 ${info.participantCount}/${info.maxParticipants}명${info.joinLocked ? ' · 입장 잠김' : ''}${info.status !== 'open' ? ' · 종료됨' : ''}` : code.length === 6 && error ? error : '코드 6자를 입력하세요'}
          </span>
        </div>
        <div className="field">
          <label htmlFor="nick">별명</label>
          <input id="nick" className="input" value={nickname} maxLength={MAX_NICKNAME} autoComplete="off" placeholder="예: 파란고래" onChange={(e) => setNickname(e.target.value)} />
          <span className="hint">{MAX_NICKNAME}자 이내. 다른 사람에게는 선생님이 공개한 범위에서만 보입니다.</span>
        </div>
        {info?.groups.length ? (
          <div className="field">
            <label htmlFor="group">모둠 (선택)</label>
            <select id="group" className="select" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">선택 안 함</option>
              {info.groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        ) : null}
        {error && code.length === 6 && info ? <p className="error-text" role="alert">{error}</p> : null}
        <Button type="submit" variant="primary" size="lg" loading={joining} disabledReason={!info ? '올바른 코드를 입력하세요' : info.joinLocked ? '입장이 잠겨 있습니다' : info.status !== 'open' ? '종료된 탐사실입니다' : undefined} iconRight="arrowRight">입장하기</Button>
        {recent.length ? (
          <div className="stack" style={{ gap: 6 }}>
            <span className="label">이 기기에서 최근 입장한 탐사실</span>
            {recent.slice(0, 3).map((r) => (
              <button key={r.code} type="button" className="stage-item" onClick={() => navigate(`/room/${r.code}`)}><span className="n">↺</span><span>{r.code} · {r.nickname}{r.title ? ` · ${r.title}` : ''}</span></button>
            ))}
          </div>
        ) : null}
      </form>
      <div aria-hidden="true" />
    </div>
  )
}
