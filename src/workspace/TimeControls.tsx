import { useMemo } from 'react'
import { DAY_MS, formatKstDate, isoDateUtc, monthlyCounts, dailyCounts } from '@shared/geo/time'
import { Button } from '../ui/Button'
import type { TimeState, TimeMode } from './useTimePlayback'

interface Props {
  times: number[]
  range: { min: number; max: number }
  state: TimeState
  visibleCount: number
  totalCount: number
  onPlay: () => void
  onPause: () => void
  onRewind: () => void
  onSeek: (t: number) => void
  onMode: (m: TimeMode) => void
  onSpeed: (d: number) => void
  onWindowDays: (d: number) => void
  compact?: boolean
}

export function TimeControls({ times, range, state, visibleCount, totalCount, onPlay, onPause, onRewind, onSeek, onMode, onSpeed, onWindowDays, compact }: Props) {
  const spanDays = (range.max - range.min) / DAY_MS
  const buckets = useMemo(() => (spanDays > 400 ? monthlyCounts(times, range.min, range.max + 1).map((b) => ({ t: b.month, count: b.count })) : dailyCounts(times, range.min, range.max + 1).map((b) => ({ t: b.day, count: b.count }))), [times, range.min, range.max, spanDays])
  const maxCount = Math.max(1, ...buckets.map((b) => b.count))
  const bucketLabel = spanDays > 400 ? '월별 관측 건수' : '일별 관측 건수'
  return (
    <div className="panel time-controls" role="group" aria-label="시간 재생 컨트롤">
      {!compact ? (
        <svg className="spark" viewBox={`0 0 ${buckets.length} 28`} preserveAspectRatio="none" aria-label={`${bucketLabel} 작은 차트`} role="img">
          {buckets.map((b, i) => (
            <rect key={i} x={i} y={28 - (b.count / maxCount) * 26} width={1} height={(b.count / maxCount) * 26} fill={b.t <= state.cursor || state.mode === 'all' ? 'rgba(242,197,124,0.75)' : 'rgba(168,188,196,0.25)'} />
          ))}
          {state.mode !== 'all' ? <rect x={((state.cursor - range.min) / Math.max(1, range.max - range.min)) * buckets.length} y={0} width={0.6} height={28} fill="#66d8c1" /> : null}
        </svg>
      ) : null}
      <div className="time-row">
        <Button variant="quiet" size="sm" icon="rewind" onClick={onRewind} aria-label="처음으로" title="처음으로" />
        {state.playing
          ? <Button variant="quiet" size="sm" icon="pause" onClick={onPause} aria-label="일시정지" title="일시정지" />
          : <Button variant="quiet" size="sm" icon="play" onClick={onPlay} aria-label="재생" title="재생 (관측 기록의 시간순 표시)" />}
        <input
          className="range" type="range" min={range.min} max={range.max} step={DAY_MS} value={Math.min(range.max, Math.max(range.min, state.cursor))}
          onChange={(e) => onSeek(Number(e.target.value))} aria-label="시간 슬라이더" aria-valuetext={formatKstDate(state.cursor)}
        />
        <select className="select" style={{ width: 'auto', minHeight: 36, padding: '4px 8px', fontSize: 13 }} value={state.mode} onChange={(e) => onMode(e.target.value as TimeMode)} aria-label="시간 보기 방식">
          <option value="all">한 번에 전체</option>
          <option value="cumulative">누적</option>
          <option value="window">이동 시간창</option>
        </select>
        {state.mode === 'window' ? (
          <select className="select" style={{ width: 'auto', minHeight: 36, padding: '4px 8px', fontSize: 13 }} value={state.windowDays} onChange={(e) => onWindowDays(Number(e.target.value))} aria-label="시간창 길이">
            {[7, 30, 90, 365].map((d) => <option key={d} value={d}>{d}일</option>)}
          </select>
        ) : null}
        <select className="select" style={{ width: 'auto', minHeight: 36, padding: '4px 8px', fontSize: 13 }} value={state.daysPerSecond} onChange={(e) => onSpeed(Number(e.target.value))} aria-label="재생 속도">
          {[7, 30, 90, 180, 365].map((d) => <option key={d} value={d}>{d}일/초</option>)}
        </select>
      </div>
      <div className="time-readout num">
        <span>{state.mode === 'all' ? `전체 기간 ${isoDateUtc(range.min)} ~ ${isoDateUtc(range.max)} (UTC)` : `시점 ${formatKstDate(state.cursor)} (KST) · ${isoDateUtc(state.cursor)} UTC`}</span>
        <span>표시 {visibleCount.toLocaleString()} / 전체 {totalCount.toLocaleString()}건</span>
        {!compact ? <span className="muted">{bucketLabel} · 위험도 차트가 아닙니다</span> : null}
      </div>
    </div>
  )
}
