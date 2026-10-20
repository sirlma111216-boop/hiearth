// 앱 설정 — 로컬에 저장. 소리는 기본 꺼짐.
import { useSyncExternalStore } from 'react'

export interface Settings {
  soundEnabled: boolean
  masterVolume: number
  effectsVolume: number
  ambientVolume: number
  motion: 'system' | 'reduce' | 'allow'
  contrast: 'normal' | 'high'
  preferredMapMode: '2d' | '3d'
  lowPower: boolean
  /** 랜딩 배경 지구의 자전 (동작 줄이기와 별개로 끌 수 있음) */
  landingMotion: boolean
}

const KEY = 'ee.settings.v1'
const DEFAULTS: Settings = {
  soundEnabled: false,
  masterVolume: 0.8,
  effectsVolume: 0.22,
  ambientVolume: 0.07,
  motion: 'system',
  contrast: 'normal',
  preferredMapMode: '3d',
  lowPower: false,
  landingMotion: true,
}

let current: Settings = load()
const listeners = new Set<() => void>()

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<Settings>
    return { ...DEFAULTS, ...parsed, soundEnabled: parsed.soundEnabled === true }
  } catch {
    return { ...DEFAULTS }
  }
}

function apply(s: Settings) {
  const root = document.documentElement
  root.dataset.motion = s.motion === 'system' ? '' : s.motion
  if (!root.dataset.motion) delete root.dataset.motion
  root.dataset.contrast = s.contrast === 'high' ? 'high' : ''
  if (!root.dataset.contrast) delete root.dataset.contrast
}

export function getSettings(): Settings { return current }

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* 저장 불가 시 무시 */ }
  apply(current)
  listeners.forEach((l) => l())
}

export function useSettings(): Settings {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => current, () => current)
}

/** 실제로 동작을 줄여야 하는가 (시스템 설정 + 앱 설정) */
export function prefersReducedMotion(): boolean {
  if (current.motion === 'reduce') return true
  if (current.motion === 'allow') return false
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

if (typeof document !== 'undefined') apply(current)
