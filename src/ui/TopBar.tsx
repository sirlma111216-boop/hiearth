import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from './Logo'
import { Icon } from './Icon'
import { useSettings } from '../settings/settings'
import { audio } from '../audio/AudioManager'
import { useToast } from './Toast'

export function TopBar({ center, right, brandTo = '/' }: { center?: ReactNode; right?: ReactNode; brandTo?: string }) {
  const settings = useSettings()
  const toast = useToast()
  const toggleSound = async () => {
    if (settings.soundEnabled) { audio.disable(); toast.push('소리를 껐습니다.') }
    else { await audio.enable(); toast.push('소리를 켰습니다. 음원 파일이 없는 효과음은 무음으로 처리됩니다.') }
  }
  return (
    <header className="topbar">
      <Link to={brandTo} className="topbar-brand" aria-label="지구 탐사대 홈">
        <Logo size={30} />
        <span><strong>지구 탐사대</strong><small>EARTH ATELIER</small></span>
      </Link>
      <div className="topbar-center">{center}</div>
      <div className="topbar-right">
        {right}
        <button type="button" className="btn btn-quiet btn-icon" onClick={toggleSound} aria-pressed={settings.soundEnabled} aria-label={settings.soundEnabled ? '소리 끄기' : '소리 켜기'} title={settings.soundEnabled ? '소리 끄기' : '소리 켜기 (기본 꺼짐)'}>
          <Icon name={settings.soundEnabled ? 'sound' : 'soundOff'} />
        </button>
        <Link to="/settings" className="btn btn-quiet btn-icon" aria-label="설정" title="설정"><Icon name="settings" /></Link>
      </div>
    </header>
  )
}
