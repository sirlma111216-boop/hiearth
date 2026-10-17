// 소리 관리 — 기본 꺼짐. 사용자가 켠 뒤에만 AudioContext를 만든다.
// public/audio/<id>.mp3 가 있으면 재생하고, 없으면 조용히 건너뛴다 (unavailable).
import { getSettings, updateSettings } from '../settings/settings'
import manifestJson from './manifest.json'

export type AudioId = 'ambient-observatory' | 'enter-expedition' | 'ui-tap' | 'submit-confirm' | 'evidence-reveal' | 'boundary-reveal' | 'report-ready' | 'gentle-attention'

interface AudioAsset { id: AudioId; path: string; channel: 'ambient' | 'effect'; loop: boolean; initialGainAfterOptIn: number }
export type AssetStatus = 'unknown' | 'loading' | 'ready' | 'unavailable'

const manifest = manifestJson as { assets: AudioAsset[] }
const assets = new Map<AudioId, AudioAsset>(manifest.assets.map((a) => [a.id, a]))

class AudioManager {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private effects: GainNode | null = null
  private ambient: GainNode | null = null
  private buffers = new Map<AudioId, AudioBuffer>()
  private status = new Map<AudioId, AssetStatus>()
  private lastPlayed = new Map<AudioId, number>()
  private ambientSource: AudioBufferSourceNode | null = null
  private listeners = new Set<() => void>()

  getStatus(id: AudioId): AssetStatus { return this.status.get(id) ?? 'unknown' }
  subscribe(l: () => void) { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  private emit() { this.listeners.forEach((l) => l()) }

  /** 명시적 사용자 조작에서만 호출한다 */
  async enable(): Promise<void> {
    updateSettings({ soundEnabled: true })
    await this.ensureContext()
    this.applyVolumes()
  }

  disable() {
    updateSettings({ soundEnabled: false })
    this.stopAmbient()
    if (this.ctx?.state === 'running') void this.ctx.suspend()
  }

  applyVolumes() {
    const s = getSettings()
    if (!this.master || !this.effects || !this.ambient) return
    this.master.gain.value = s.soundEnabled ? s.masterVolume : 0
    this.effects.gain.value = s.effectsVolume
    this.ambient.gain.value = s.ambientVolume
  }

  private async ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume()
      return
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    this.ctx = new Ctx()
    this.master = this.ctx.createGain()
    this.effects = this.ctx.createGain()
    this.ambient = this.ctx.createGain()
    this.effects.connect(this.master)
    this.ambient.connect(this.master)
    this.master.connect(this.ctx.destination)
    await this.ctx.resume()
  }

  private async load(id: AudioId): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(id)
    if (cached) return cached
    const asset = assets.get(id)
    if (!asset || !this.ctx) return null
    const st = this.status.get(id)
    if (st === 'unavailable') return null
    this.status.set(id, 'loading'); this.emit()
    try {
      const res = await fetch('/' + asset.path.replace(/^assets\//, ''), { cache: 'force-cache' })
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok || type.includes('text/html')) throw new Error('missing')
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer())
      this.buffers.set(id, buf)
      this.status.set(id, 'ready'); this.emit()
      return buf
    } catch {
      this.status.set(id, 'unavailable'); this.emit()
      return null
    }
  }

  /** 효과음 재생 — 같은 소리를 500ms 안에 겹쳐 재생하지 않는다 */
  async play(id: AudioId) {
    const s = getSettings()
    if (!s.soundEnabled) return
    const now = performance.now()
    if (now - (this.lastPlayed.get(id) ?? -Infinity) < 500) return
    this.lastPlayed.set(id, now)
    await this.ensureContext()
    if (!this.ctx || !this.effects) return
    const buf = await this.load(id)
    if (!buf) return
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.effects)
    src.start()
  }

  async startAmbient() {
    const s = getSettings()
    if (!s.soundEnabled) return
    await this.ensureContext()
    if (!this.ctx || !this.ambient || this.ambientSource) return
    const buf = await this.load('ambient-observatory')
    if (!buf || this.ambientSource) return
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.connect(this.ambient)
    src.start()
    this.ambientSource = src
  }

  stopAmbient() {
    try { this.ambientSource?.stop() } catch { /* noop */ }
    this.ambientSource = null
  }

  get ambientPlaying() { return !!this.ambientSource }

  /** 설정 화면에서 파일 존재 여부를 미리 확인 (재생하지 않음) */
  async probe(id: AudioId): Promise<AssetStatus> {
    const asset = assets.get(id)
    if (!asset) return 'unavailable'
    if (this.status.get(id) === 'ready') return 'ready'
    try {
      const res = await fetch('/' + asset.path.replace(/^assets\//, ''), { method: 'HEAD' })
      const type = res.headers.get('content-type') ?? ''
      const ok = res.ok && !type.includes('text/html')
      if (!ok) this.status.set(id, 'unavailable')
      else if (this.status.get(id) !== 'ready') this.status.set(id, 'unknown')
      this.emit()
      return ok ? (this.status.get(id) ?? 'unknown') : 'unavailable'
    } catch {
      this.status.set(id, 'unavailable'); this.emit()
      return 'unavailable'
    }
  }

  listAssets(): AudioAsset[] { return [...assets.values()] }
}

export const audio = new AudioManager()
