import { useEffect, useState } from 'react'
import { TopBar } from '../ui/TopBar'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { useSettings, updateSettings } from '../settings/settings'
import { audio, type AssetStatus, type AudioId } from '../audio/AudioManager'
import { clearAllLocal, listRoomInfos, loadLocalRecord } from '../inquiry/localStore'
import { useToast } from '../ui/Toast'

export default function Settings() {
  const s = useSettings()
  const toast = useToast()
  const [status, setStatus] = useState<Record<string, AssetStatus>>({})
  const [confirmClear, setConfirmClear] = useState(false)
  const local = loadLocalRecord()
  const rooms = listRoomInfos()
  useEffect(() => {
    let alive = true
    Promise.all(audio.listAssets().map(async (a) => [a.id, await audio.probe(a.id as AudioId)] as const)).then((rows) => { if (alive) setStatus(Object.fromEntries(rows)) })
    return () => { alive = false }
  }, [])
  const label: Record<AssetStatus, string> = { unknown: '파일 있음', loading: '불러오는 중', ready: '준비됨', unavailable: '파일 없음 · 무음' }
  return (
    <div className="page page-narrow stack" style={{ gap: 20 }}>
      <TopBar />
      <div><span className="eyebrow">Settings</span><h1 style={{ fontSize: 30, marginTop: 8 }}>설정</h1></div>

      <section className="card stack">
        <h2 style={{ fontSize: 18 }}>소리</h2>
        <p className="hint">기본은 꺼짐입니다. 교실에서는 교사 기기만 켜고 학생 기기는 무음으로 쓰는 것이 편합니다.</p>
        <label className="checkbox"><input type="checkbox" checked={s.soundEnabled} onChange={(e) => (e.target.checked ? audio.enable() : audio.disable())} /> 소리 켜기</label>
        <div className="field"><label>전체 음량 <span className="num">{Math.round(s.masterVolume * 100)}%</span></label><input className="range" type="range" min={0} max={1} step={0.05} value={s.masterVolume} onChange={(e) => { updateSettings({ masterVolume: Number(e.target.value) }); audio.applyVolumes() }} /></div>
        <div className="field"><label>효과음 <span className="num">{Math.round(s.effectsVolume * 100)}%</span></label><input className="range" type="range" min={0} max={1} step={0.02} value={s.effectsVolume} onChange={(e) => { updateSettings({ effectsVolume: Number(e.target.value) }); audio.applyVolumes() }} /></div>
        <div className="field"><label>배경음 <span className="num">{Math.round(s.ambientVolume * 100)}%</span></label><input className="range" type="range" min={0} max={0.5} step={0.01} value={s.ambientVolume} onChange={(e) => { updateSettings({ ambientVolume: Number(e.target.value) }); audio.applyVolumes() }} /></div>
        <div className="row">
          <Button size="sm" variant="secondary" icon="sound" onClick={() => void audio.play('ui-tap')} disabledReason={!s.soundEnabled ? '소리를 먼저 켜세요' : undefined}>효과음 시험</Button>
          <Button size="sm" variant="secondary" icon={audio.ambientPlaying ? 'pause' : 'play'} onClick={() => (audio.ambientPlaying ? audio.stopAmbient() : void audio.startAmbient())} disabledReason={!s.soundEnabled ? '소리를 먼저 켜세요' : undefined}>배경음 {audio.ambientPlaying ? '끄기' : '켜기'}</Button>
        </div>
        <table className="data"><thead><tr><th>음원</th><th>상태</th></tr></thead><tbody>
          {audio.listAssets().map((a) => <tr key={a.id}><td>{a.id}</td><td>{label[status[a.id] ?? 'unknown']}</td></tr>)}
        </tbody></table>
        <p className="tiny muted">음원 파일이 없으면 해당 소리는 건너뜁니다. 실제 지진 소리나 실측 신호의 음향화가 아닌 인터페이스용 음향입니다.</p>
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: 18 }}>화면과 동작</h2>
        <div className="field"><label htmlFor="motion">동작 줄이기</label>
          <select id="motion" className="select" value={s.motion} onChange={(e) => updateSettings({ motion: e.target.value as typeof s.motion })}>
            <option value="system">시스템 설정 따르기</option><option value="reduce">줄이기 (전환·이동 최소화)</option><option value="allow">허용</option>
          </select></div>
        <div className="field"><label htmlFor="contrast">화면 대비</label>
          <select id="contrast" className="select" value={s.contrast} onChange={(e) => updateSettings({ contrast: e.target.value as typeof s.contrast })}>
            <option value="normal">기본</option><option value="high">높게</option>
          </select></div>
        <div className="field"><label htmlFor="mapmode">기본 지도</label>
          <select id="mapmode" className="select" value={s.preferredMapMode} onChange={(e) => updateSettings({ preferredMapMode: e.target.value as '2d' | '3d' })}>
            <option value="3d">3D 지구본</option><option value="2d">2D 지도</option>
          </select></div>
        <label className="checkbox"><input type="checkbox" checked={s.lowPower} onChange={(e) => updateSettings({ lowPower: e.target.checked })} /> 저사양 모드 (항상 2D 지도로 시작)</label>
        <label className="checkbox"><input type="checkbox" checked={s.landingMotion} onChange={(e) => updateSettings({ landingMotion: e.target.checked })} /> 배경 움직임 (첫 화면 지구의 자전)</label>
        <span className="hint">동작 줄이기가 켜져 있으면 배경 지구는 자전하지 않습니다. 3D를 쓸 수 없는 기기에서는 정적 배경이 보입니다.</span>
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: 18 }}>이 기기의 기록</h2>
        <p className="hint">혼자 탐사 기록과 탐사실 임시 사본은 이 기기에만 저장됩니다. 서버의 탐사실 기록은 별개이며 탐사실 만료·삭제 정책을 따릅니다.</p>
        <ul className="small muted" style={{ paddingLeft: 20, margin: 0 }}>
          <li>혼자 탐사 기록: {local ? `있음 (단계 ${local.stage}, 증거 ${local.evidence.length}개)` : '없음'}</li>
          <li>탐사실 입장 기록: {rooms.length ? rooms.map((r) => r.code).join(', ') : '없음'}</li>
        </ul>
        <Button variant="destructive" icon="trash" onClick={() => setConfirmClear(true)}>이 기기 기록 지우기</Button>
      </section>
      <Dialog open={confirmClear} title="이 기기의 탐구 기록을 지울까요?" onClose={() => setConfirmClear(false)} actions={<><Button variant="secondary" onClick={() => setConfirmClear(false)}>취소</Button><Button variant="destructive" onClick={() => { clearAllLocal(); setConfirmClear(false); toast.push('이 기기의 기록을 지웠습니다.') }}>지우기</Button></>}>
        <p className="muted">혼자 탐사 기록, 탐사실 입장 기록과 임시 사본이 지워집니다. 서버에 저장된 탐사실 기록은 영향을 받지 않습니다. 설정은 유지됩니다.</p>
      </Dialog>
    </div>
  )
}
