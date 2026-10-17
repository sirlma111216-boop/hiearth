// 3D 지구본 — Three.js. 실제 Natural Earth 육지 텍스처, GPU 점 렌더링(시간·규모 필터는 셰이더에서), 대원 보간 선.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { LngLat, ViewState } from '@shared/domain/types'
import { densify, lngLatToVec3, vec3ToLngLat } from '@shared/geo/sphere'
import { prefersReducedMotion } from '../settings/settings'
import { GUESS_STYLES, MAP_COLORS } from './colors'
import { buildLandTexture } from './landTexture'
import type { Interaction, MapEvents, MapRenderer, MapScene } from './types'
import { ALL_LAYERS } from './types'

const EPOCH_DAY = 86_400_000
const toDays = (ms: number) => (ms - Date.UTC(2000, 0, 1)) / EPOCH_DAY

const POINT_VERT = /* glsl */ `
  attribute float aTime; attribute float aMag; attribute float aSize;
  uniform float uTmin; uniform float uTmax; uniform float uMinMag; uniform float uPixelRatio; uniform float uScale;
  varying float vHollow; varying float vAlpha;
  void main() {
    vHollow = aMag < -900.0 ? 1.0 : 0.0;
    bool timeOk = aTime >= uTmin && aTime <= uTmax;
    bool magOk = aMag < -900.0 || aMag >= uMinMag;
    vec3 n = normalize(position);
    vec3 toCam = normalize(cameraPosition - position);
    float facing = dot(n, toCam);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = aSize * uPixelRatio * uScale / max(0.6, -mv.z);
    if (!timeOk || !magOk || facing < 0.04) { size = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
    gl_PointSize = size;
    vAlpha = smoothstep(0.04, 0.25, facing);
  }
`
const POINT_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uShape; uniform float uOpacity;
  varying float vHollow; varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a;
    if (uShape < 0.5) {
      float d = length(c);
      if (vHollow > 0.5) { a = smoothstep(0.5, 0.42, d) * smoothstep(0.26, 0.34, d); }
      else { a = smoothstep(0.5, 0.40, d); }
    } else {
      // 삼각형
      float y = -c.y + 0.5; // 0 아래, 1 위
      float hw = (1.0 - y) * 0.5;
      float inside = step(abs(c.x), hw * 0.95) * step(0.05, y) * step(y, 0.98);
      a = inside;
    }
    if (a < 0.02) discard;
    gl_FragColor = vec4(uColor, a * uOpacity * vAlpha);
  }
`

const ATMOS_VERT = /* glsl */ `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz; gl_Position = projectionMatrix * mv; }`
const ATMOS_FRAG = /* glsl */ `varying vec3 vN; varying vec3 vP; void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(-vP))); float a = pow(f, 3.2) * 0.55; gl_FragColor = vec4(0.4, 0.85, 0.76, a); }`

type Pointed = { kind: 'earthquake' | 'volcano'; id: string; pos: THREE.Vector3 }

export class Globe3D implements MapRenderer {
  readonly kind = '3d' as const
  private container: HTMLElement | null = null
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls | null = null
  private globe: THREE.Mesh
  private sphereMat: THREE.MeshStandardMaterial
  private quakes: THREE.Points | null = null
  private volcanoes: THREE.Points | null = null
  private plates: THREE.LineSegments | null = null
  private guessGroup = new THREE.Group()
  private draftLine: Line2 | null = null
  private selectionRing: THREE.Mesh
  private lineMaterials: LineMaterial[] = []
  private data: MapScene
  private interaction: Interaction = { mode: 'move', drawMode: 'freehand' }
  private events: MapEvents = {}
  private raf = 0
  private w = 1
  private h = 1
  private ro: ResizeObserver | null = null
  private texKey = ''
  private quakeKey = ''
  private volcanoKey = ''
  private plateKey = ''
  private guessKey = ''
  private raycaster = new THREE.Raycaster()
  private stroke: LngLat[] | null = null
  private pointerDown: { x: number; y: number; moved: boolean; button: number } | null = null
  private anim: { from: THREE.Vector3; to: THREE.Vector3; start: number; dur: number } | null = null
  private lastEmittedView = ''
  private contextLost = false

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50)
    this.camera.position.set(0, 0, 3.2)
    this.sphereMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.0 })
    this.globe = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.sphereMat)
    this.scene.add(this.globe)
    const atmos = new THREE.Mesh(new THREE.SphereGeometry(1.012, 64, 48), new THREE.ShaderMaterial({ vertexShader: ATMOS_VERT, fragmentShader: ATMOS_FRAG, transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending }))
    this.scene.add(atmos)
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.35))
    const sun = new THREE.DirectionalLight(0xfff2dc, 1.1)
    sun.position.set(2.5, 1.8, 2.2)
    this.scene.add(sun)
    this.scene.add(this.guessGroup)
    this.selectionRing = new THREE.Mesh(new THREE.RingGeometry(0.016, 0.022, 40), new THREE.MeshBasicMaterial({ color: MAP_COLORS.selection, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false }))
    this.selectionRing.visible = false
    this.selectionRing.renderOrder = 10
    this.scene.add(this.selectionRing)
    this.data = { earthquakes: [], volcanoes: [], plates: [], land: null, layers: { ...ALL_LAYERS }, timeRange: null, minMagnitude: 0, guesses: [], draft: null, selected: null, overlapEmphasis: false }
    const el = this.renderer.domElement
    el.tabIndex = 0
    el.setAttribute('role', 'application')
    el.setAttribute('aria-label', '3D 지구본. 드래그로 회전, 휠로 확대·축소, 화살표로 회전, 그리기 모드에서 클릭으로 점 추가')
    el.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; this.events.onContextLost?.() })
  }

  mount(container: HTMLElement) {
    this.container = container
    container.appendChild(this.renderer.domElement)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enablePan = false
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.09
    this.controls.minDistance = 1.18
    this.controls.maxDistance = 4.6
    this.controls.rotateSpeed = 0.55
    this.controls.zoomSpeed = 0.9
    this.controls.addEventListener('start', () => { this.anim = null; this.events.onInteract?.() })
    this.controls.addEventListener('change', () => this.emitView())
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerup', this.onPointerUp)
    el.addEventListener('pointercancel', this.onPointerUp)
    el.addEventListener('keydown', this.onKeyDown)
    el.addEventListener('dblclick', (e) => { e.preventDefault(); if (this.interaction.mode === 'draw' && this.interaction.drawMode === 'polyline') this.events.onDrawKey?.('finish') })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    this.loop()
  }

  unmount() {
    cancelAnimationFrame(this.raf)
    this.ro?.disconnect()
    this.controls?.dispose()
    this.renderer.domElement.remove()
    this.renderer.dispose()
    this.container = null
  }

  focus() { this.renderer.domElement.focus() }
  setEvents(e: MapEvents) { this.events = e }
  setInteraction(i: Interaction) {
    this.interaction = i
    this.stroke = null
    if (this.controls) this.controls.enableRotate = true
  }

  resize() {
    if (!this.container) return
    const r = this.container.getBoundingClientRect()
    this.w = Math.max(1, Math.round(r.width))
    this.h = Math.max(1, Math.round(r.height))
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.setSize(this.w, this.h, true)
    this.camera.aspect = this.w / this.h
    this.camera.updateProjectionMatrix()
    for (const m of this.lineMaterials) m.resolution.set(this.w, this.h)
  }

  // ---------- 시점 ----------
  private distanceForZoom(zoom: number) { return Math.max(1.18, Math.min(4.6, 1 + 2.7 / Math.max(0.8, zoom))) }
  private zoomForDistance(d: number) { return 2.7 / Math.max(1e-3, d - 1) }

  getView(): ViewState {
    const d = this.camera.position.length()
    const p = this.camera.position
    const ll = vec3ToLngLat([p.x, p.y, p.z])
    return { center: ll, zoom: Math.round(this.zoomForDistance(d) * 1000) / 1000 }
  }

  centerLngLat(): LngLat { return this.getView().center }

  setView(view: ViewState, animate = false) {
    const v = lngLatToVec3(view.center, this.distanceForZoom(view.zoom))
    const target = new THREE.Vector3(v[0], v[1], v[2])
    if (!animate || prefersReducedMotion()) {
      this.camera.position.copy(target)
      this.camera.lookAt(0, 0, 0)
      this.controls?.update()
      this.anim = null
      return
    }
    this.anim = { from: this.camera.position.clone(), to: target, start: performance.now(), dur: 800 }
  }

  private emitView() {
    const v = this.getView()
    const key = `${v.center[0].toFixed(2)},${v.center[1].toFixed(2)},${v.zoom.toFixed(3)}`
    if (key === this.lastEmittedView) return
    this.lastEmittedView = key
    this.events.onViewChange?.(v)
  }

  // ---------- 장면 ----------
  setScene(scene: MapScene) {
    this.data = scene
    this.updateTexture()
    this.updateQuakes()
    this.updateVolcanoes()
    this.updatePlates()
    this.updateGuesses()
    this.updateDraft()
    this.updateSelection()
  }

  private updateTexture() {
    if (!this.data.land) return
    const key = 'land'
    if (this.texKey === key) return
    this.texKey = key
    const tex = new THREE.CanvasTexture(buildLandTexture(this.data.land, 4096))
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    this.sphereMat.map = tex
    this.sphereMat.needsUpdate = true
  }

  private makePoints(count: number, fill: (i: number, pos: Float32Array, time: Float32Array, mag: Float32Array, size: Float32Array) => void, color: string, shape: number, opacity: number): THREE.Points {
    const pos = new Float32Array(count * 3), time = new Float32Array(count), mag = new Float32Array(count), size = new Float32Array(count)
    for (let i = 0; i < count; i++) fill(i, pos, time, mag, size)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aTime', new THREE.BufferAttribute(time, 1))
    geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1))
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    const mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT, fragmentShader: POINT_FRAG, transparent: true, depthWrite: false,
      uniforms: {
        uTmin: { value: -1e9 }, uTmax: { value: 1e9 }, uMinMag: { value: 0 }, uPixelRatio: { value: this.renderer.getPixelRatio() },
        uScale: { value: 1 }, uColor: { value: new THREE.Color(color) }, uShape: { value: shape }, uOpacity: { value: opacity },
      },
    })
    const pts = new THREE.Points(geo, mat)
    pts.frustumCulled = false
    return pts
  }

  private updateQuakes() {
    const eq = this.data.earthquakes
    const key = `${eq.length}:${eq[0]?.id ?? ''}:${eq[eq.length - 1]?.id ?? ''}`
    if (key !== this.quakeKey) {
      this.quakeKey = key
      if (this.quakes) { this.scene.remove(this.quakes); this.quakes.geometry.dispose(); (this.quakes.material as THREE.Material).dispose() }
      this.quakes = this.makePoints(eq.length, (i, pos, time, mag, size) => {
        const e = eq[i]
        const v = lngLatToVec3([e.lon, e.lat], 1.004)
        pos[i * 3] = v[0]; pos[i * 3 + 1] = v[1]; pos[i * 3 + 2] = v[2]
        time[i] = toDays(e.time)
        mag[i] = e.mag ?? -999
        size[i] = e.mag == null ? 7 : Math.max(5, 4 + (e.mag - 4.5) * 4)
      }, MAP_COLORS.quake, 0, eq.length > 6000 ? 0.7 : 0.88)
      this.scene.add(this.quakes)
    }
    if (this.quakes) {
      const u = (this.quakes.material as THREE.ShaderMaterial).uniforms
      u.uTmin.value = this.data.timeRange ? toDays(this.data.timeRange.min) : -1e9
      u.uTmax.value = this.data.timeRange ? toDays(this.data.timeRange.max) : 1e9
      u.uMinMag.value = this.data.minMagnitude
      this.quakes.visible = this.data.layers.earthquakes
    }
  }

  private updateVolcanoes() {
    const vs = this.data.volcanoes
    const key = `${vs.length}`
    if (key !== this.volcanoKey) {
      this.volcanoKey = key
      if (this.volcanoes) { this.scene.remove(this.volcanoes); this.volcanoes.geometry.dispose() }
      this.volcanoes = this.makePoints(vs.length, (i, pos, time, mag, size) => {
        const v = lngLatToVec3([vs[i].lon, vs[i].lat], 1.005)
        pos[i * 3] = v[0]; pos[i * 3 + 1] = v[1]; pos[i * 3 + 2] = v[2]
        time[i] = 0; mag[i] = 99; size[i] = 11
      }, MAP_COLORS.volcano, 1, 0.95)
      this.scene.add(this.volcanoes)
    }
    if (this.volcanoes) this.volcanoes.visible = this.data.layers.volcanoes
  }

  private updatePlates() {
    const pl = this.data.plates
    const key = `${pl.length}`
    if (key !== this.plateKey) {
      this.plateKey = key
      if (this.plates) { this.scene.remove(this.plates); this.plates.geometry.dispose() }
      const verts: number[] = []
      for (const f of pl) for (const line of f.lines) {
        const d = densify(line, 1.5)
        for (let i = 1; i < d.length; i++) {
          const a = lngLatToVec3(d[i - 1], 1.003), b = lngLatToVec3(d[i], 1.003)
          verts.push(a[0], a[1], a[2], b[0], b[1], b[2])
        }
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3))
      this.plates = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: MAP_COLORS.plate, transparent: true, opacity: 0.95 }))
      this.scene.add(this.plates)
    }
    if (this.plates) this.plates.visible = this.data.layers.plates
  }

  private makeFatLine(points: LngLat[], color: string, width: number, dashed: boolean, opacity = 1): Line2 {
    const d = densify(points, 1)
    const positions: number[] = []
    for (const p of d) { const v = lngLatToVec3(p, 1.006); positions.push(v[0], v[1], v[2]) }
    const geo = new LineGeometry()
    geo.setPositions(positions)
    const mat = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: width, dashed, dashSize: 0.02, gapSize: 0.012, transparent: true, opacity, depthTest: true })
    mat.resolution.set(this.w, this.h)
    this.lineMaterials.push(mat)
    const line = new Line2(geo, mat)
    line.computeLineDistances()
    return line
  }

  private clearGroup(g: THREE.Group) {
    for (const c of [...g.children]) {
      g.remove(c)
      const l = c as Line2
      l.geometry?.dispose()
      const m = l.material as LineMaterial
      if (m) { m.dispose(); this.lineMaterials = this.lineMaterials.filter((x) => x !== m) }
    }
  }

  private updateGuesses() {
    const L = this.data.layers
    const key = JSON.stringify(this.data.guesses.map((g) => [g.id, g.style, g.lines.length, g.lines.map((l) => l.length)])) + `|${L.myFirst}${L.myRevised}${L.others}${this.data.overlapEmphasis}`
    if (key === this.guessKey) return
    this.guessKey = key
    this.clearGroup(this.guessGroup)
    for (const g of this.data.guesses) {
      const visible = g.style === 'first' ? L.myFirst : g.style === 'revised' ? L.myRevised : g.style === 'others' ? L.others : true
      if (!visible) continue
      const st = GUESS_STYLES[g.style]
      const op = g.style === 'others' ? (this.data.overlapEmphasis ? 0.4 : 0.6) : 1
      for (const line of g.lines) if (line.length >= 2) this.guessGroup.add(this.makeFatLine(line, st.color, st.width, st.dash.length > 0, op))
    }
  }

  private updateDraft() {
    if (this.draftLine) { this.scene.remove(this.draftLine); this.draftLine.geometry.dispose(); const m = this.draftLine.material as LineMaterial; m.dispose(); this.lineMaterials = this.lineMaterials.filter((x) => x !== m); this.draftLine = null }
    const d = this.data.draft
    if (!d) return
    const pts = d.cursor && d.mode === 'polyline' ? [...d.points, d.cursor] : d.points
    if (pts.length < 2) return
    this.draftLine = this.makeFatLine(pts, MAP_COLORS.draft, 2.4, true)
    this.scene.add(this.draftLine)
  }

  private updateSelection() {
    const s = this.data.selected
    if (!s) { this.selectionRing.visible = false; return }
    const item = s.kind === 'earthquake' ? this.data.earthquakes.find((e) => e.id === s.id) : this.data.volcanoes.find((v) => String(v.number) === s.id)
    if (!item) { this.selectionRing.visible = false; return }
    const v = lngLatToVec3([item.lon, item.lat], 1.008)
    this.selectionRing.position.set(v[0], v[1], v[2])
    this.selectionRing.lookAt(0, 0, 0)
    this.selectionRing.visible = true
  }

  // ---------- 렌더 루프 ----------
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    if (this.contextLost) return
    if (this.anim) {
      const t = Math.min(1, (performance.now() - this.anim.start) / this.anim.dur)
      const e = 1 - Math.pow(1 - t, 3)
      const from = this.anim.from, to = this.anim.to
      const df = from.length(), dt = to.length()
      const dir = from.clone().normalize().lerp(to.clone().normalize(), e).normalize()
      this.camera.position.copy(dir.multiplyScalar(df + (dt - df) * e))
      this.camera.lookAt(0, 0, 0)
      if (t >= 1) { this.anim = null; this.emitView() }
    }
    this.controls?.update()
    // 거리에 따른 점 크기·회전 속도 보정
    const d = this.camera.position.length()
    const scale = 2.6 / d
    for (const p of [this.quakes, this.volcanoes]) if (p) (p.material as THREE.ShaderMaterial).uniforms.uScale.value = scale
    if (this.controls) this.controls.rotateSpeed = 0.2 + 0.35 * Math.min(1, (d - 1.18) / 2)
    const ringScale = Math.max(0.5, (d - 1) / 2.2)
    this.selectionRing.scale.setScalar(ringScale)
    this.renderer.render(this.scene, this.camera)
  }

  async capture(maxWidth = 900): Promise<string | null> {
    try {
      this.renderer.render(this.scene, this.camera)
      const src = this.renderer.domElement
      const scale = Math.min(1, maxWidth / src.width)
      const out = document.createElement('canvas')
      out.width = Math.round(src.width * scale)
      out.height = Math.round(src.height * scale)
      const ctx = out.getContext('2d')!
      ctx.fillStyle = MAP_COLORS.oceanDeep
      ctx.fillRect(0, 0, out.width, out.height)
      ctx.drawImage(src, 0, 0, out.width, out.height)
      return out.toDataURL('image/png')
    } catch {
      return null
    }
  }

  // ---------- 입력 ----------
  private ndc(e: PointerEvent | MouseEvent): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect()
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  }

  private hitGlobe(e: PointerEvent | MouseEvent): LngLat | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera)
    const hits = this.raycaster.intersectObject(this.globe, false)
    if (!hits.length) return null
    const p = hits[0].point
    return vec3ToLngLat([p.x, p.y, p.z])
  }

  private onPointerDown = (e: PointerEvent) => {
    this.renderer.domElement.focus({ preventScroll: true })
    this.pointerDown = { x: e.clientX, y: e.clientY, moved: false, button: e.button }
    if (this.interaction.mode === 'draw' && this.interaction.drawMode === 'freehand' && e.button === 0 && e.isPrimary) {
      const p = this.hitGlobe(e)
      if (p) {
        this.stroke = [p]
        if (this.controls) this.controls.enableRotate = false
        this.renderer.domElement.setPointerCapture(e.pointerId)
      }
    }
  }

  private onPointerMove = (e: PointerEvent) => {
    if (this.pointerDown && Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y) > 4) this.pointerDown.moved = true
    if (this.stroke) {
      const p = this.hitGlobe(e)
      if (p) {
        const last = this.stroke[this.stroke.length - 1]
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.15) { this.stroke.push(p); this.events.onDrawProgress?.(this.stroke) }
      }
      return
    }
    if (this.interaction.mode === 'draw' && this.interaction.drawMode === 'polyline') this.events.onDrawCursor?.(this.hitGlobe(e))
  }

  private onPointerUp = (e: PointerEvent) => {
    const pd = this.pointerDown
    this.pointerDown = null
    if (this.stroke) {
      const s = this.stroke
      this.stroke = null
      if (this.controls) this.controls.enableRotate = true
      try { this.renderer.domElement.releasePointerCapture(e.pointerId) } catch { /* noop */ }
      if (s.length >= 2) this.events.onDrawStroke?.(s)
      else this.events.onDrawProgress?.([])
      return
    }
    if (!pd || pd.moved || pd.button !== 0) return
    if (this.interaction.mode === 'draw' && this.interaction.drawMode === 'polyline') {
      const p = this.hitGlobe(e)
      if (p) this.events.onDrawPoint?.(p)
      return
    }
    if (this.interaction.mode === 'move') this.events.onPick?.(this.pickNear(e))
  }

  /** 화면에서 가장 가까운 보이는 점 (셰이더 필터와 동일한 조건으로 CPU에서 검사) */
  private pickNear(e: PointerEvent): { kind: 'earthquake' | 'volcano'; id: string } | null {
    const r = this.renderer.domElement.getBoundingClientRect()
    const px = e.clientX - r.left, py = e.clientY - r.top
    const camDir = this.camera.position.clone().normalize()
    const candidates: Pointed[] = []
    const tr = this.data.timeRange
    if (this.data.layers.earthquakes) {
      for (const q of this.data.earthquakes) {
        if (tr && (q.time < tr.min || q.time > tr.max)) continue
        if (q.mag != null && q.mag < this.data.minMagnitude) continue
        const v = lngLatToVec3([q.lon, q.lat], 1.004)
        const vec = new THREE.Vector3(v[0], v[1], v[2])
        if (vec.clone().normalize().dot(camDir) < 0.04) continue
        candidates.push({ kind: 'earthquake', id: q.id, pos: vec })
      }
    }
    if (this.data.layers.volcanoes) {
      for (const vo of this.data.volcanoes) {
        const v = lngLatToVec3([vo.lon, vo.lat], 1.005)
        const vec = new THREE.Vector3(v[0], v[1], v[2])
        if (vec.clone().normalize().dot(camDir) < 0.04) continue
        candidates.push({ kind: 'volcano', id: String(vo.number), pos: vec })
      }
    }
    let best: { kind: 'earthquake' | 'volcano'; id: string; d: number } | null = null
    const limit = 14 * 14
    for (const c of candidates) {
      const p = c.pos.clone().project(this.camera)
      const sx = (p.x + 1) / 2 * r.width, sy = (1 - p.y) / 2 * r.height
      const d = (sx - px) ** 2 + (sy - py) ** 2
      if (d < limit && (!best || d < best.d)) best = { kind: c.kind, id: c.id, d }
    }
    return best ? { kind: best.kind, id: best.id } : null
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const v = this.getView()
    const stepDeg = 6 / Math.max(1, v.zoom)
    const go = (dl: number, dla: number) => this.setView({ center: [v.center[0] + dl, Math.max(-85, Math.min(85, v.center[1] + dla))], zoom: v.zoom })
    switch (e.key) {
      case 'ArrowLeft': go(-stepDeg, 0); break
      case 'ArrowRight': go(stepDeg, 0); break
      case 'ArrowUp': go(0, stepDeg); break
      case 'ArrowDown': go(0, -stepDeg); break
      case '+': case '=': this.setView({ center: v.center, zoom: v.zoom * 1.4 }); break
      case '-': case '_': this.setView({ center: v.center, zoom: v.zoom / 1.4 }); break
      case 'Enter': if (this.interaction.mode === 'draw') this.events.onDrawKey?.('add'); else return; break
      case 'Backspace': if (this.interaction.mode === 'draw') this.events.onDrawKey?.('undo'); else return; break
      case 'Escape': if (this.interaction.mode === 'draw') this.events.onDrawKey?.('finish'); else return; break
      default: return
    }
    e.preventDefault()
    this.emitView()
  }
}

export function webglSupported(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}
