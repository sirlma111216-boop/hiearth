// 지도 래퍼 — 2D/3D 전환, 동일한 장면·시점·입력 상태 유지, WebGL 미지원·컨텍스트 유실 시 2D 전환.
import { useEffect, useImperativeHandle, useRef, forwardRef, useState } from 'react'
import type { ViewState, MapMode, LngLat } from '@shared/domain/types'
import type { Interaction, MapEvents, MapRenderer, MapScene } from './types'
import { Map2D } from './Map2D'

export interface MapViewHandle {
  setView: (v: ViewState, animate?: boolean) => void
  getView: () => ViewState
  capture: (maxWidth?: number) => Promise<string | null>
  focus: () => void
  centerLngLat: () => LngLat
}

interface Props {
  mode: MapMode
  scene: MapScene
  interaction: Interaction
  events: MapEvents
  initialView: ViewState
  /** 외부에서 시점을 바꾸고 싶을 때 (프리셋·따라가기). 값이 바뀔 때만 적용 */
  requestedView?: { view: ViewState; animate: boolean; seq: number } | null
  onModeFallback?: (reason: string) => void
  className?: string
}

let globeModule: Promise<typeof import('./Globe3D')> | null = null
const loadGlobe = () => (globeModule ??= import('./Globe3D'))

export const MapView = forwardRef<MapViewHandle, Props>(function MapView({ mode, scene, interaction, events, initialView, requestedView, onModeFallback, className }, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<MapRenderer | null>(null)
  const viewRef = useRef<ViewState>(initialView)
  const sceneRef = useRef(scene)
  const eventsRef = useRef(events)
  const interactionRef = useRef(interaction)
  const [activeMode, setActiveMode] = useState<MapMode | null>(null)
  const [loading, setLoading] = useState(false)
  sceneRef.current = scene
  eventsRef.current = events
  interactionRef.current = interaction

  useImperativeHandle(ref, () => ({
    setView: (v, animate) => { viewRef.current = v; rendererRef.current?.setView(v, animate) },
    getView: () => rendererRef.current?.getView() ?? viewRef.current,
    capture: (w) => rendererRef.current?.capture(w) ?? Promise.resolve(null),
    focus: () => rendererRef.current?.focus(),
    centerLngLat: () => rendererRef.current?.centerLngLat() ?? viewRef.current.center,
  }), [])

  // 렌더러 생성/교체
  useEffect(() => {
    let cancelled = false
    const host = hostRef.current
    if (!host) return
    const wrappedEvents: MapEvents = {
      onViewChange: (v) => { viewRef.current = v; eventsRef.current.onViewChange?.(v) },
      onPick: (p) => eventsRef.current.onPick?.(p),
      onDrawPoint: (p) => eventsRef.current.onDrawPoint?.(p),
      onDrawProgress: (p) => eventsRef.current.onDrawProgress?.(p),
      onDrawStroke: (p) => eventsRef.current.onDrawStroke?.(p),
      onDrawCursor: (p) => eventsRef.current.onDrawCursor?.(p),
      onDrawKey: (k) => eventsRef.current.onDrawKey?.(k),
      onInteract: () => eventsRef.current.onInteract?.(),
      onContextLost: () => { eventsRef.current.onContextLost?.(); onModeFallback?.('3D 그래픽 컨텍스트가 끊겨 2D 지도로 전환했습니다. 작성 중인 내용은 유지됩니다.') },
    }
    const attach = (r: MapRenderer) => {
      if (cancelled) { return }
      if (rendererRef.current) { viewRef.current = rendererRef.current.getView(); rendererRef.current.unmount() }
      rendererRef.current = r
      r.setEvents(wrappedEvents)
      r.mount(host)
      r.setScene(sceneRef.current)
      r.setInteraction(interactionRef.current)
      r.setView(viewRef.current, false)
      setActiveMode(r.kind)
      setLoading(false)
    }
    if (mode === '3d') {
      setLoading(true)
      loadGlobe().then((m) => {
        if (cancelled) return
        if (!m.webglSupported()) { onModeFallback?.('이 기기는 3D 지구본(WebGL)을 지원하지 않아 2D 지도로 표시합니다.'); attach(new Map2D()); return }
        try { attach(new m.Globe3D()) } catch { onModeFallback?.('3D 지구본을 시작하지 못해 2D 지도로 표시합니다.'); attach(new Map2D()) }
      }).catch(() => { if (!cancelled) { onModeFallback?.('3D 모듈을 불러오지 못해 2D 지도로 표시합니다.'); attach(new Map2D()) } })
    } else {
      attach(new Map2D())
    }
    return () => { cancelled = true }

  }, [mode])

  useEffect(() => () => { rendererRef.current?.unmount(); rendererRef.current = null }, [])
  useEffect(() => { rendererRef.current?.setScene(scene) }, [scene, activeMode])
  useEffect(() => { rendererRef.current?.setInteraction(interaction) }, [interaction, activeMode])
  useEffect(() => {
    if (!requestedView) return
    viewRef.current = requestedView.view
    rendererRef.current?.setView(requestedView.view, requestedView.animate)
  }, [requestedView])

  const cls = ['workspace-map', interaction.mode === 'draw' ? 'is-draw' : 'is-move', className ?? ''].join(' ')
  return (
    <div ref={hostRef} className={cls} data-map-mode={activeMode ?? ''}>
      {loading ? <div className="status-pill" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 2 }}>3D 지구본 준비 중…</div> : null}
      <svg className="map-crosshair" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="none" stroke="#8ce8d6" strokeWidth="1.5" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" stroke="#8ce8d6" strokeWidth="1.5" /></svg>
    </div>
  )
})
