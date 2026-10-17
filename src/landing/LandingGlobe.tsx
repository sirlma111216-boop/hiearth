// 랜딩 배경 지구 — 정적 이미지를 먼저 보여 주고, 3D가 준비되면 부드럽게 전환한다.
// 보이지 않으면(탭 전환·스크롤 아웃) 렌더링을 멈추고, 다시 보이면 멈춘 각도에서 이어간다.
import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion, useSettings } from '../settings/settings'

type Status = 'loading' | 'ready' | 'failed'

export function LandingGlobe({ onStatus }: { onStatus?: (s: Status) => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Status>('loading')
  const settings = useSettings()
  const motion = settings.landingMotion && !prefersReducedMotion()
  const handleRef = useRef<import('./globeScene').GlobeHandle | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let visible = true
    let pageVisible = document.visibilityState === 'visible'
    const update = () => handleRef.current?.setRunning(visible && pageVisible)
    const io = new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); update() }, { threshold: 0.05 })
    io.observe(host)
    const onVis = () => { pageVisible = document.visibilityState === 'visible'; update() }
    document.addEventListener('visibilitychange', onVis)
    const ro = new ResizeObserver(() => handleRef.current?.resize())
    ro.observe(host)

    const mobile = window.innerWidth < 760
    const fail = (reason: string) => { if (cancelled) return; setStatus('failed'); onStatus?.('failed'); console.info('[landing-globe] 정적 배경 유지:', reason) }
    // 정적 배경이 먼저 그려진 뒤 3D 모듈을 받는다
    const idle = (cb: () => void) => {
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
      if (w.requestIdleCallback) w.requestIdleCallback(cb, { timeout: 1500 })
      else window.setTimeout(cb, 300)
    }
    idle(() => {
      if (cancelled) return
      import('./globeScene').then((m) => {
        if (cancelled) return
        const probe = document.createElement('canvas')
        if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) { fail('no webgl'); return }
        const h = m.createLandingGlobe({
          container: host, mobile, motion,
          onReady: () => { if (cancelled) return; setStatus('ready'); onStatus?.('ready') },
          onFail: fail,
        })
        if (!h) return
        handleRef.current = h
        h.setMotion(motion)
        update()
      }).catch((e) => fail(String(e)))
    })
    return () => {
      cancelled = true
      io.disconnect(); ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      handleRef.current?.dispose()
      handleRef.current = null
    }
    // motion 변경은 아래 effect에서 처리한다
  }, [])

  useEffect(() => { handleRef.current?.setMotion(motion) }, [motion])

  return <div ref={hostRef} className={'landing-globe' + (status === 'ready' ? ' is-ready' : '')} aria-hidden="true" data-status={status} />
}
