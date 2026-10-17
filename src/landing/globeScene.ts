// 랜딩용 자전 지구 — Three.js. 장식 전용(탐구 지도가 아니다). 설정 상수는 아래 GLOBE_CONFIG에서 조정한다.
import * as THREE from 'three'

export const GLOBE_CONFIG = {
  /** 한 바퀴 도는 데 걸리는 시간(초). 서쪽→동쪽 자전 */
  rotationPeriodSec: 180,
  /** 구름층은 지표보다 이만큼 느리게(비율). 미술적 연출 */
  cloudRelativeSpeed: 0.85,
  /** 처음에 카메라를 향하는 경도(한국·동아시아·서태평양) */
  initialFacingLng: 127,
  /** 처음 기울기(위도 방향, 도). 양수면 북반구가 조금 더 보인다 */
  initialTiltDeg: 12,
  /** 지구 지름이 화면 높이에서 차지하는 비율 (데스크톱 / 모바일) */
  diameterOfHeight: { desktop: 1.3, mobile: 0.86 },
  /** 지구 중심 위치: 화면 너비·높이 기준 (-0.5~0.5, 0이 중앙). 데스크톱은 오른쪽으로 치우치고 일부가 잘린다 */
  center: { desktop: { x: 0.27, y: -0.06 }, mobile: { x: 0, y: -0.14 } },
  /** 조명 — 화면 오른쪽 위에 고정(지구와 함께 돌지 않음) */
  sun: { intensity: 2.3, color: 0xfff1dc, ambient: 1.05, direction: [0.9, 0.75, 0.55] as [number, number, number] },
  /** 밤 면 보조광: 왼쪽 아래에서 차가운 색으로 — 어두운 면이 단색으로 뭉개지지 않게 */
  fill: { intensity: 0.75, color: 0x9fc4d8, direction: [-0.9, -0.15, 0.5] as [number, number, number] },
  exposure: 1.3,
  /** 이 너비(px) 미만이면 모바일 구도. 창 크기가 바뀌면 다시 계산한다 */
  mobileMaxWidth: 760,
  /** 대기 가장자리 색·세기 */
  atmosphere: { color: 0xa9ead9, strength: 0.14, power: 5.5, radius: 1.016 },
  /** 텍스처 해상도 (데스크톱 / 모바일) */
  textures: {
    desktop: { earth: '/textures/earth-4096.webp', clouds: '/textures/clouds-2048.webp', pixelRatioCap: 2 },
    mobile: { earth: '/textures/earth-2048.webp', clouds: '/textures/clouds-1024.webp', pixelRatioCap: 1.5 },
  },
}

const ATMOS_VERT = /* glsl */ `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz; gl_Position = projectionMatrix * mv; }`
const ATMOS_FRAG = /* glsl */ `uniform vec3 uColor; uniform float uStrength; uniform float uPower; varying vec3 vN; varying vec3 vP;
void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(-vP))); float a = pow(f, uPower) * uStrength; gl_FragColor = vec4(uColor, a); }`

export interface GlobeHandle {
  /** 보이는 동안만 돌린다 */
  setRunning(v: boolean): void
  /** 동작 줄이기: 회전 없이 한 번만 그린다 */
  setMotion(v: boolean): void
  resize(): void
  dispose(): void
}

export interface GlobeOptions {
  container: HTMLElement
  mobile: boolean
  motion: boolean
  onReady: () => void
  onFail: (reason: string) => void
}

export function createLandingGlobe(opts: GlobeOptions): GlobeHandle | null {
  const { container, mobile } = opts
  const tex = mobile ? GLOBE_CONFIG.textures.mobile : GLOBE_CONFIG.textures.desktop
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  } catch (e) {
    opts.onFail('webgl: ' + String(e))
    return null
  }
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = GLOBE_CONFIG.exposure
  const canvas = renderer.domElement
  canvas.setAttribute('aria-hidden', 'true')
  canvas.tabIndex = -1
  canvas.style.pointerEvents = 'none'
  container.appendChild(canvas)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
  camera.position.set(0, 0, 6)
  camera.lookAt(0, 0, 0)

  const group = new THREE.Group()
  scene.add(group)
  const loader = new THREE.TextureLoader()
  const earthMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.0 })
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, mobile ? 72 : 112, mobile ? 48 : 80), earthMat)
  // 자전축 기울기(연출용): 북반구가 조금 더 보이도록
  earth.rotation.x = THREE.MathUtils.degToRad(GLOBE_CONFIG.initialTiltDeg)
  group.add(earth)
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, roughness: 1 })
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.008, mobile ? 64 : 96, mobile ? 40 : 64), cloudMat)
  clouds.rotation.x = earth.rotation.x
  clouds.visible = false
  group.add(clouds)
  const atmos = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_CONFIG.atmosphere.radius, 64, 48), new THREE.ShaderMaterial({
    vertexShader: ATMOS_VERT, fragmentShader: ATMOS_FRAG, transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(GLOBE_CONFIG.atmosphere.color) }, uStrength: { value: GLOBE_CONFIG.atmosphere.strength }, uPower: { value: GLOBE_CONFIG.atmosphere.power } },
  }))
  group.add(atmos)

  scene.add(new THREE.AmbientLight(0x9fb8c8, GLOBE_CONFIG.sun.ambient))
  const sun = new THREE.DirectionalLight(GLOBE_CONFIG.sun.color, GLOBE_CONFIG.sun.intensity)
  sun.position.set(...GLOBE_CONFIG.sun.direction).multiplyScalar(10)
  scene.add(sun) // 월드 공간 고정: 지구(group)의 자식이 아니다
  const fill = new THREE.DirectionalLight(GLOBE_CONFIG.fill.color, GLOBE_CONFIG.fill.intensity)
  fill.position.set(...GLOBE_CONFIG.fill.direction).multiplyScalar(10)
  scene.add(fill)
  scene.add(new THREE.HemisphereLight(0x9cc3d6, 0x1b2b3a, 0.5))

  // 초기 방향: 경도 L이 카메라(+z)를 향하도록. 자전은 y축 양의 방향(서→동).
  const baseRotation = THREE.MathUtils.degToRad(-(GLOBE_CONFIG.initialFacingLng + 90))
  let angle = 0 // 누적 자전각(라디안). 멈췄다 이어가도 뛰지 않는다
  let running = false
  let motion = opts.motion
  let raf = 0
  let lastT = 0
  let disposed = false
  let ready = false

  const layout = () => {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight)
    renderer.setPixelRatio(Math.min(tex.pixelRatioCap, window.devicePixelRatio || 1))
    renderer.setSize(w, h, true)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    // 화면 높이에서 지구 지름이 차지하는 비율 → 카메라 거리에서의 가시 높이로 환산
    const visibleH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const visibleW = visibleH * camera.aspect
    // 구도는 현재 컨테이너 너비로 매번 판단한다 (텍스처 해상도만 처음 결정)
    const narrow = w < GLOBE_CONFIG.mobileMaxWidth
    const cfg = narrow ? GLOBE_CONFIG.diameterOfHeight.mobile : GLOBE_CONFIG.diameterOfHeight.desktop
    const diameter = narrow ? Math.min(visibleW * 0.9, visibleH * cfg) : visibleH * cfg
    const r = diameter / 2
    group.scale.setScalar(r)
    const c = narrow ? GLOBE_CONFIG.center.mobile : GLOBE_CONFIG.center.desktop
    group.position.set(c.x * visibleW, c.y * visibleH, 0)
  }

  const renderOnce = () => {
    earth.rotation.y = baseRotation + angle
    clouds.rotation.y = baseRotation + angle * GLOBE_CONFIG.cloudRelativeSpeed
    renderer.render(scene, camera)
  }

  const loop = (t: number) => {
    if (disposed) return
    raf = running ? requestAnimationFrame(loop) : 0
    if (!running) return
    if (lastT) {
      const dt = Math.min(0.25, (t - lastT) / 1000)
      if (motion) angle += (dt / GLOBE_CONFIG.rotationPeriodSec) * Math.PI * 2
    }
    lastT = t
    renderOnce()
  }

  const start = () => {
    if (!running || !ready || raf) return
    lastT = 0
    raf = requestAnimationFrame(loop)
  }
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; lastT = 0 }

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); opts.onFail('context lost') })

  layout()
  loader.load(tex.earth, (t) => {
    if (disposed) { t.dispose(); return }
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    earthMat.map = t
    earthMat.needsUpdate = true
    ready = true
    renderOnce()
    opts.onReady()
    start()
    loader.load(tex.clouds, (ct) => {
      if (disposed) { ct.dispose(); return }
      cloudMat.alphaMap = ct
      cloudMat.needsUpdate = true
      clouds.visible = true
      if (!running || !motion) renderOnce()
    }, undefined, () => { /* 구름은 선택 사항: 실패해도 지구는 유지 */ })
  }, undefined, () => opts.onFail('texture'))

  return {
    setRunning(v) { running = v; if (v) start(); else stop() },
    setMotion(v) { motion = v; if (ready) renderOnce() },
    resize() { layout(); if (ready) renderOnce() },
    dispose() {
      disposed = true
      stop()
      earth.geometry.dispose(); clouds.geometry.dispose(); atmos.geometry.dispose()
      earthMat.map?.dispose(); cloudMat.alphaMap?.dispose()
      earthMat.dispose(); cloudMat.dispose(); (atmos.material as THREE.Material).dispose()
      renderer.dispose()
      canvas.remove()
    },
  }
}
