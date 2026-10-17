// 2D 대화형 지도 — 캔버스 + 로컬 육지 자료. 외부 타일 서비스에 의존하지 않는다.
import type { LngLat, ViewState } from '@shared/domain/types'
import { prefersReducedMotion } from '../settings/settings'
import { clampView, drawScene, makeProjector, pickAt, strokeLngLatLine } from './scene2d'
import { GUESS_STYLES } from './colors'
import type { Interaction, MapEvents, MapRenderer, MapScene } from './types'
import { ALL_LAYERS } from './types'

interface PointerInfo { id: number; x: number; y: number; type: string }

export class Map2D implements MapRenderer {
  readonly kind = '2d' as const
  private container: HTMLElement | null = null
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private scene: MapScene
  private view: ViewState = { center: [20, 10], zoom: 1 }
  private interaction: Interaction = { mode: 'move', drawMode: 'freehand' }
  private events: MapEvents = {}
  private w = 1
  private h = 1
  private dpr = 1
  private raf = 0
  private dirty = true
  private pointers = new Map<number, PointerInfo>()
  private dragStart: { x: number; y: number; view: ViewState; moved: boolean } | null = null
  private pinchStart: { dist: number; zoom: number; mid: [number, number]; center: LngLat } | null = null
  private stroke: LngLat[] | null = null
  private strokePointerId: number | null = null
  private anim: { from: ViewState; to: ViewState; start: number; dur: number } | null = null
  private ro: ResizeObserver | null = null

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.tabIndex = 0
    this.canvas.setAttribute('role', 'application')
    this.canvas.setAttribute('aria-label', '2D 지도. 화살표로 이동, +/-로 확대·축소, 그리기 모드에서 Enter로 점 추가, Backspace로 점 삭제, Esc로 선 완료')
    const ctx = this.canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다')
    this.ctx = ctx
    this.scene = { earthquakes: [], volcanoes: [], plates: [], land: null, layers: { ...ALL_LAYERS }, timeRange: null, minMagnitude: 0, guesses: [], draft: null, selected: null, overlapEmphasis: false }
  }

  mount(container: HTMLElement) {
    this.container = container
    container.appendChild(this.canvas)
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    const c = this.canvas
    c.addEventListener('pointerdown', this.onPointerDown)
    c.addEventListener('pointermove', this.onPointerMove)
    c.addEventListener('pointerup', this.onPointerUp)
    c.addEventListener('pointercancel', this.onPointerUp)
    c.addEventListener('pointerleave', this.onPointerLeave)
    c.addEventListener('wheel', this.onWheel, { passive: false })
    c.addEventListener('keydown', this.onKeyDown)
    c.addEventListener('dblclick', this.onDblClick)
    c.addEventListener('blur', () => { this.container?.classList.remove('is-keyboard') })
    c.addEventListener('contextmenu', (e) => e.preventDefault())
    this.loop()
  }

  unmount() {
    cancelAnimationFrame(this.raf)
    this.ro?.disconnect()
    this.canvas.remove()
    this.container = null
  }

  focus() { this.canvas.focus() }

  setScene(scene: MapScene) { this.scene = scene; this.dirty = true }
  setInteraction(i: Interaction) { this.interaction = i; this.stroke = null; this.dirty = true }
  setEvents(e: MapEvents) { this.events = e }
  getView(): ViewState { return this.view }
  centerLngLat(): LngLat { return this.view.center }

  setView(view: ViewState, animate = false) {
    const target = clampView(view, this.w, this.h)
    if (!animate || prefersReducedMotion()) {
      this.view = target
      this.anim = null
      this.dirty = true
      return
    }
    this.anim = { from: this.view, to: target, start: performance.now(), dur: 650 }
    this.dirty = true
  }

  resize() {
    if (!this.container) return
    const rect = this.container.getBoundingClientRect()
    this.w = Math.max(1, Math.round(rect.width))
    this.h = Math.max(1, Math.round(rect.height))
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = Math.round(this.w * this.dpr)
    this.canvas.height = Math.round(this.h * this.dpr)
    this.canvas.style.width = this.w + 'px'
    this.canvas.style.height = this.h + 'px'
    this.view = clampView(this.view, this.w, this.h)
    this.dirty = true
  }

  async capture(maxWidth = 900): Promise<string | null> {
    try {
      const scale = Math.min(1, maxWidth / this.w)
      const out = document.createElement('canvas')
      out.width = Math.round(this.w * scale)
      out.height = Math.round(this.h * scale)
      const ctx = out.getContext('2d')
      if (!ctx) return null
      drawScene(ctx, this.scene, this.view, out.width, out.height, 1)
      return out.toDataURL('image/png')
    } catch {
      return null
    }
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    if (this.anim) {
      const t = Math.min(1, (performance.now() - this.anim.start) / this.anim.dur)
      const e = 1 - Math.pow(1 - t, 3)
      const { from, to } = this.anim
      // 경도는 가까운 방향으로
      let dl = to.center[0] - from.center[0]
      if (dl > 180) dl -= 360
      if (dl < -180) dl += 360
      this.view = { center: [from.center[0] + dl * e, from.center[1] + (to.center[1] - from.center[1]) * e], zoom: from.zoom * Math.pow(to.zoom / from.zoom, e) }
      if (t >= 1) { this.view = to; this.anim = null; this.events.onViewChange?.(this.view) }
      this.dirty = true
    }
    if (!this.dirty) return
    this.dirty = false
    drawScene(this.ctx, this.scene, this.view, this.w, this.h, this.dpr)
    this.drawLiveStroke()
  }

  /** 포인터를 누른 채 움직이는 동안의 선 — 떼기 전에도 바로 보이게 */
  private drawLiveStroke() {
    const s = this.stroke
    if (!s || s.length < 1) return
    const ctx = this.ctx
    ctx.save()
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    const P = makeProjector(this.view, this.w, this.h)
    const st = GUESS_STYLES.draft
    ctx.beginPath()
    strokeLngLatLine(ctx, P, s)
    ctx.strokeStyle = st.color
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.shadowColor = 'rgba(102,216,193,0.6)'
    ctx.shadowBlur = 6
    ctx.stroke()
    ctx.shadowBlur = 0
    const [x0, y0] = P.project(s[0][0], s[0][1])
    ctx.beginPath(); ctx.arc(x0, y0, 4, 0, Math.PI * 2); ctx.fillStyle = st.color; ctx.fill()
    ctx.restore()
  }

  // ---------- 입력 ----------
  private local(e: PointerEvent | MouseEvent | WheelEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  private onPointerDown = (e: PointerEvent) => {
    this.canvas.focus({ preventScroll: true })
    this.events.onInteract?.()
    this.anim = null
    const [x, y] = this.local(e)
    this.pointers.set(e.pointerId, { id: e.pointerId, x, y, type: e.pointerType })
    this.canvas.setPointerCapture(e.pointerId)
    if (this.pointers.size === 2) {
      // 두 손가락: 그리던 선은 취소하고 핀치로 전환
      this.stroke = null
      this.strokePointerId = null
      this.dragStart = null
      const [a, b] = [...this.pointers.values()]
      this.pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.view.zoom, mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], center: this.view.center }
      this.events.onDrawCursor?.(null)
      return
    }
    if (this.pointers.size > 2) return
    const isDraw = this.interaction.mode === 'draw' && e.button === 0
    if (isDraw) {
      if (this.interaction.drawMode === 'freehand') {
        const p = makeProjector(this.view, this.w, this.h).invert(x, y)
        if (p) { this.stroke = [p]; this.strokePointerId = e.pointerId }
      } else {
        this.dragStart = { x, y, view: this.view, moved: false }
      }
      return
    }
    this.dragStart = { x, y, view: this.view, moved: false }
  }

  private onPointerMove = (e: PointerEvent) => {
    const [x, y] = this.local(e)
    const p = this.pointers.get(e.pointerId)
    if (p) { p.x = x; p.y = y }
    if (this.pinchStart && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid: [number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2]
      const zoom = this.pinchStart.zoom * (dist / Math.max(1, this.pinchStart.dist))
      this.zoomAround(this.pinchStart.mid, zoom, this.pinchStart.center, this.pinchStart.zoom)
      // 이동
      const P = makeProjector(this.view, this.w, this.h)
      const dx = mid[0] - this.pinchStart.mid[0], dy = mid[1] - this.pinchStart.mid[1]
      if (dx || dy) {
        this.view = clampView({ center: [this.view.center[0] - dx / P.scale / (Math.PI / 180), this.view.center[1] + dy / P.scale / (Math.PI / 180)], zoom: this.view.zoom }, this.w, this.h)
        this.pinchStart.mid = mid
      }
      this.dirty = true
      this.events.onViewChange?.(this.view)
      return
    }
    if (this.stroke && this.strokePointerId === e.pointerId) {
      const pt = makeProjector(this.view, this.w, this.h).invert(x, y)
      if (pt) {
        const last = this.stroke[this.stroke.length - 1]
        const P = makeProjector(this.view, this.w, this.h)
        const [lx, ly] = P.project(last[0], last[1])
        if (Math.hypot(lx - x, ly - y) >= 2.5) {
          this.stroke.push(pt)
          this.events.onDrawProgress?.(this.stroke)
          this.dirty = true
        }
      }
      return
    }
    if (this.interaction.mode === 'draw' && this.interaction.drawMode === 'polyline' && !this.dragStart) {
      this.events.onDrawCursor?.(makeProjector(this.view, this.w, this.h).invert(x, y))
    }
    if (this.dragStart && this.pointers.size === 1) {
      const dx = x - this.dragStart.x, dy = y - this.dragStart.y
      if (!this.dragStart.moved && Math.hypot(dx, dy) < 4) return
      this.dragStart.moved = true
      const P = makeProjector(this.dragStart.view, this.w, this.h)
      const D2R = Math.PI / 180
      this.view = clampView({ center: [this.dragStart.view.center[0] - dx / P.scale / D2R, this.dragStart.view.center[1] + dy / P.scale / D2R], zoom: this.view.zoom }, this.w, this.h)
      this.dirty = true
      this.events.onViewChange?.(this.view)
      if (this.interaction.mode === 'draw') this.events.onDrawCursor?.(P.invert(x, y))
    }
  }

  private onPointerUp = (e: PointerEvent) => {
    const [x, y] = this.local(e)
    this.pointers.delete(e.pointerId)
    try { this.canvas.releasePointerCapture(e.pointerId) } catch { /* noop */ }
    if (this.pinchStart) {
      if (this.pointers.size < 2) this.pinchStart = null
      return
    }
    if (this.stroke && this.strokePointerId === e.pointerId) {
      const s = this.stroke
      this.stroke = null
      this.strokePointerId = null
      if (s.length >= 2) this.events.onDrawStroke?.(s)
      else this.events.onDrawProgress?.([])
      this.dirty = true
      return
    }
    if (this.dragStart) {
      const moved = this.dragStart.moved
      this.dragStart = null
      if (moved) return
      if (this.interaction.mode === 'draw' && this.interaction.drawMode === 'polyline') {
        const p = makeProjector(this.view, this.w, this.h).invert(x, y)
        if (p) this.events.onDrawPoint?.(p)
        return
      }
      if (this.interaction.mode === 'move') {
        const pick = pickAt(this.scene, this.view, this.w, this.h, x, y)
        this.events.onPick?.(pick)
      }
    }
  }

  private onPointerLeave = () => { this.events.onDrawCursor?.(null) }

  private onDblClick = (e: MouseEvent) => {
    e.preventDefault()
    if (this.interaction.mode === 'draw' && this.interaction.drawMode === 'polyline') { this.events.onDrawKey?.('finish'); return }
    const [x, y] = this.local(e)
    this.zoomAround([x, y], this.view.zoom * 1.8, this.view.center, this.view.zoom, true)
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.events.onInteract?.()
    this.anim = null
    const [x, y] = this.local(e)
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016))
    this.zoomAround([x, y], this.view.zoom * factor, this.view.center, this.view.zoom)
    this.events.onViewChange?.(this.view)
  }

  /** 화면의 한 점을 고정한 채 확대·축소 */
  private zoomAround(px: [number, number], zoom: number, baseCenter: LngLat, baseZoom: number, emit = false) {
    const z = Math.max(0.8, Math.min(48, zoom))
    const base = makeProjector({ center: baseCenter, zoom: baseZoom }, this.w, this.h)
    const anchor = base.invert(px[0], px[1]) ?? baseCenter
    const after = makeProjector({ center: baseCenter, zoom: z }, this.w, this.h)
    const [ax, ay] = after.project(anchor[0], anchor[1])
    const D2R = Math.PI / 180
    const dx = ax - px[0], dy = ay - px[1]
    this.view = clampView({ center: [baseCenter[0] + dx / after.scale / D2R, baseCenter[1] - dy / after.scale / D2R], zoom: z }, this.w, this.h)
    this.dirty = true
    if (emit) this.events.onViewChange?.(this.view)
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const step = 40
    const D2R = Math.PI / 180
    const P = makeProjector(this.view, this.w, this.h)
    const move = (dx: number, dy: number) => {
      this.view = clampView({ center: [this.view.center[0] + dx / P.scale / D2R, this.view.center[1] - dy / P.scale / D2R], zoom: this.view.zoom }, this.w, this.h)
      this.dirty = true
      this.events.onViewChange?.(this.view)
    }
    const showCrosshair = () => { this.container?.classList.add('is-keyboard') }
    switch (e.key) {
      case 'ArrowLeft': move(-step, 0); showCrosshair(); break
      case 'ArrowRight': move(step, 0); showCrosshair(); break
      case 'ArrowUp': move(0, -step); showCrosshair(); break
      case 'ArrowDown': move(0, step); showCrosshair(); break
      case '+': case '=': this.zoomAround([this.w / 2, this.h / 2], this.view.zoom * 1.4, this.view.center, this.view.zoom, true); break
      case '-': case '_': this.zoomAround([this.w / 2, this.h / 2], this.view.zoom / 1.4, this.view.center, this.view.zoom, true); break
      case 'Enter':
        if (this.interaction.mode === 'draw') { showCrosshair(); this.events.onDrawKey?.('add') } else return
        break
      case 'Backspace':
        if (this.interaction.mode === 'draw') this.events.onDrawKey?.('undo'); else return
        break
      case 'Escape':
        if (this.interaction.mode === 'draw') this.events.onDrawKey?.('finish'); else return
        break
      default: return
    }
    e.preventDefault()
  }
}
