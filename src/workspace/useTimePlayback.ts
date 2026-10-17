// 시간 재생 — 관측 기록의 시간순 표시. 예측이나 지진파 시뮬레이션이 아니다.
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { DAY_MS } from '@shared/geo/time'

export type TimeMode = 'all' | 'cumulative' | 'window'

export interface TimeState {
  mode: TimeMode
  /** 현재 시점 (ms). 'all'이면 무시 */
  cursor: number
  windowDays: number
  playing: boolean
  /** 실제 1초당 재생되는 일수 */
  daysPerSecond: number
}

export function useTimePlayback(range: { min: number; max: number }) {
  const [state, setState] = useState<TimeState>({ mode: 'all', cursor: range.max, windowDays: 30, playing: false, daysPerSecond: 30 })
  const raf = useRef(0)
  const last = useRef(0)

  useEffect(() => {
    setState((s) => ({ ...s, cursor: Math.min(Math.max(s.cursor, range.min), range.max) }))
  }, [range.min, range.max])

  useEffect(() => {
    if (!state.playing) return
    last.current = performance.now()
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000
      last.current = now
      setState((s) => {
        const next = s.cursor + dt * s.daysPerSecond * DAY_MS
        if (next >= range.max) return { ...s, cursor: range.max, playing: false }
        return { ...s, cursor: next }
      })
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [state.playing, range.max])

  const timeRange = useMemo<{ min: number; max: number } | null>(() => {
    if (state.mode === 'all') return null
    if (state.mode === 'cumulative') return { min: range.min, max: state.cursor }
    return { min: state.cursor - state.windowDays * DAY_MS, max: state.cursor }
  }, [state.mode, state.cursor, state.windowDays, range.min])

  const play = useCallback(() => setState((s) => ({ ...s, mode: s.mode === 'all' ? 'cumulative' : s.mode, cursor: s.cursor >= range.max ? range.min : s.cursor, playing: true })), [range.max, range.min])
  const pause = useCallback(() => setState((s) => ({ ...s, playing: false })), [])
  const rewind = useCallback(() => setState((s) => ({ ...s, cursor: range.min, playing: false, mode: s.mode === 'all' ? 'cumulative' : s.mode })), [range.min])
  const seek = useCallback((t: number) => setState((s) => ({ ...s, cursor: Math.min(range.max, Math.max(range.min, t)), mode: s.mode === 'all' ? 'cumulative' : s.mode })), [range.min, range.max])
  const setMode = useCallback((mode: TimeMode) => setState((s) => ({ ...s, mode, playing: mode === 'all' ? false : s.playing })), [])
  const setSpeed = useCallback((daysPerSecond: number) => setState((s) => ({ ...s, daysPerSecond })), [])
  const setWindowDays = useCallback((windowDays: number) => setState((s) => ({ ...s, windowDays })), [])

  return { state, timeRange, play, pause, rewind, seek, setMode, setSpeed, setWindowDays }
}
