import type { Evidence, LayerId } from '@shared/domain/types'
import { MAX_EVIDENCE } from '@shared/domain/types'
import { formatKst, isoDateUtc } from '@shared/geo/time'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import type { LessonData } from '../data/lesson'
import type { RecentData, RecentFeedId } from '../data/recent'
import { RECENT_FEEDS } from '../data/recent'
import { LayerSwatch, LAYER_ITEMS } from './LayerControls'

export interface DatasetChoice { kind: 'lesson' | 'recent'; feed: RecentFeedId }

interface Props {
  lesson: LessonData
  recent: { data: RecentData | null; loading: boolean; error: string | null }
  choice: DatasetChoice
  onChoice: (c: DatasetChoice) => void
  onRefreshRecent: () => void
  layers: Record<LayerId, boolean>
  layerAvailability: Partial<Record<LayerId, string>>
  onLayer: (id: LayerId, on: boolean) => void
  minMagnitude: number
  onMinMagnitude: (m: number) => void
  evidence: Evidence[]
  canCapture: boolean
  captureDisabledReason?: string
  onCapture: () => void
  onEvidenceNote: (id: string, patch: { title?: string; note?: string }) => void
  onEvidenceRemove: (id: string) => void
  visibleCount: number
  overlapEmphasis?: boolean
  onOverlapEmphasis?: (v: boolean) => void
  readOnly?: boolean
  inputLocked?: boolean
}

const LAYER_LABELS: { id: LayerId; label: string; swatch: string }[] = [
  { id: 'earthquakes', label: '지진 (원)', swatch: 'quake' },
  { id: 'volcanoes', label: '화산 (삼각형)', swatch: 'volcano' },
  { id: 'plates', label: '판 경계 모형 (굵은 붉은 실선)', swatch: 'plate' },
  { id: 'myFirst', label: '내 최초 선 (흰 실선)', swatch: 'first' },
  { id: 'myRevised', label: '내 수정 선 (하늘색 점선)', swatch: 'revised' },
  { id: 'others', label: '다른 사람 선 (회색)', swatch: 'others' },
]

function Swatch({ kind }: { kind: string }) {
  const id = ({ quake: 'earthquakes', volcano: 'volcanoes', plate: 'plates', first: 'myFirst', revised: 'myRevised' } as Record<string, LayerId>)[kind]
  const item = LAYER_ITEMS.find((layer) => layer.id === id)
  return <LayerSwatch shape={item?.shape ?? 'line'} color={item?.color ?? 'rgba(168,188,196,0.7)'} />
}

export function EvidenceDrawer(p: Props) {
  const m = p.lesson.manifest.datasets
  const eqInfo = m.earthquakesLesson
  const recent = p.recent.data
  return (
    <div className="ws-panel panel">
      <div className="evidence-cover" aria-hidden="true">
        <img src="/images/evidence-seismic-960.webp" alt="" loading="lazy" />
        <span>EVIDENCE DRAWER</span>
      </div>
      <h2><Icon name="evidence" /> 증거 서랍</h2>

      <section className="stack" style={{ marginTop: 12 }}>
        <div className="label">자료 선택</div>
        <label className="layer-toggle">
          <input type="radio" name="ds" checked={p.choice.kind === 'lesson'} onChange={() => p.onChoice({ ...p.choice, kind: 'lesson' })} />
          <span>수업용 장기 자료 (저장 자료)</span>
        </label>
        <div className="tiny muted num" style={{ paddingLeft: 28 }}>
          {isoDateUtc(Date.parse(eqInfo.coverageStart!))} ~ {isoDateUtc(Date.parse(eqInfo.coverageEnd!) - 1)} UTC · 규모 {eqInfo.filters.minmagnitude as number} 이상 · {eqInfo.recordCount.toLocaleString()}건<br />
          USGS ComCat · 자료 수집 {isoDateUtc(Date.parse(eqInfo.retrievedAt))}
        </div>
        <label className="layer-toggle">
          <input type="radio" name="ds" checked={p.choice.kind === 'recent'} onChange={() => p.onChoice({ ...p.choice, kind: 'recent' })} />
          <span>최근 자료 (USGS 요약 피드)</span>
        </label>
        {p.choice.kind === 'recent' ? (
          <div className="stack" style={{ paddingLeft: 28 }}>
            <select className="select" style={{ minHeight: 40, fontSize: 14 }} value={p.choice.feed} onChange={(e) => p.onChoice({ kind: 'recent', feed: e.target.value as RecentFeedId })} aria-label="최근 피드 선택">
              {RECENT_FEEDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            {p.recent.loading ? <span className="tiny muted">받는 중…</span> : null}
            {p.recent.error ? <span className="error-text tiny">{p.recent.error} 저장된 수업 자료는 계속 사용할 수 있습니다.</span> : null}
            {recent ? (
              <div className="tiny muted num">
                {recent.earthquakes.length.toLocaleString()}건 · USGS 생성 {recent.generatedAt ? formatKst(recent.generatedAt) : '알 수 없음'}<br />
                수신 {formatKst(recent.receivedAt)} ({recent.source === 'cache' ? '서버 캐시' : '원본'}) · 10분 간격 자동 갱신<br />
                '실시간'은 즉각 경보가 아니며 요약 피드는 모든 지진의 완전한 기록이 아닙니다.
              </div>
            ) : null}
            <Button size="sm" variant="quiet" icon="refresh" onClick={p.onRefreshRecent} loading={p.recent.loading}>지금 새로고침</Button>
          </div>
        ) : null}
      </section>

      <hr className="divider" />
      <section className="stack">
        <div className="label">레이어</div>
        {LAYER_LABELS.map((l) => {
          const unavailable = p.layerAvailability[l.id]
          return (
            <label key={l.id} className={'layer-toggle' + (unavailable ? ' is-disabled' : '')} title={unavailable}>
              <input type="checkbox" checked={!!p.layers[l.id] && !unavailable} disabled={!!unavailable} onChange={(e) => p.onLayer(l.id, e.target.checked)} />
              <Swatch kind={l.swatch} />
              <span>{p.readOnly ? l.label.replace('내 ', '학생 ') : l.label}</span>
              {unavailable ? <span className="tiny muted" style={{ marginLeft: 'auto' }}>{unavailable}</span> : null}
            </label>
          )
        })}
        {p.onOverlapEmphasis ? (
          <label className="layer-toggle">
            <input type="checkbox" checked={!!p.overlapEmphasis} onChange={(e) => p.onOverlapEmphasis?.(e.target.checked)} />
            <span>의견 겹침 강조 (많이 고른 곳이 진하게)</span>
          </label>
        ) : null}
        <div className="field">
          <label htmlFor="minmag">최소 규모 <span className="num">M {p.minMagnitude.toFixed(1)}</span> · 표시 {p.visibleCount.toLocaleString()}건</label>
          <input id="minmag" className="range" type="range" min={0} max={8} step={0.5} value={p.minMagnitude} onChange={(e) => p.onMinMagnitude(Number(e.target.value))} />
          <span className="hint">규모가 없는 사건은 작은 속 빈 원으로 항상 표시됩니다.</span>
        </div>
      </section>

      {!p.readOnly ? (
        <>
          <hr className="divider" />
          <section className="stack">
            <div className="row between">
              <div className="label">관찰 증거 <span className="num">{p.evidence.length}/{MAX_EVIDENCE}</span></div>
              <Button size="sm" variant="primary" icon="camera" onClick={p.onCapture} disabledReason={p.canCapture ? undefined : (p.captureDisabledReason ?? '증거는 3개까지 담을 수 있습니다.')}>지금 화면 담기</Button>
            </div>
            <p className="hint">지역·배율·기간·규모 조건·레이어·선택한 사건이 함께 저장되어 나중에 같은 조건을 다시 볼 수 있습니다.</p>
            {p.evidence.map((e, i) => (
              <div key={e.id} className="evidence-item">
                {e.capture ? <img src={e.capture} alt={`증거 ${i + 1} 캡처`} /> : <div className="ph">캡처 없음</div>}
                <div className="grow stack" style={{ gap: 6 }}>
                  <input className="input" disabled={p.inputLocked} style={{ minHeight: 36, fontSize: 14 }} value={e.title} placeholder={`증거 ${i + 1} 제목`} maxLength={60} onChange={(ev) => p.onEvidenceNote(e.id, { title: ev.target.value })} aria-label={`증거 ${i + 1} 제목`} />
                  <input className="input" disabled={p.inputLocked} style={{ minHeight: 36, fontSize: 14 }} value={e.note} placeholder="짧은 메모 (무엇이 보이나요?)" maxLength={300} onChange={(ev) => p.onEvidenceNote(e.id, { note: ev.target.value })} aria-label={`증거 ${i + 1} 메모`} />
                  <div className="tiny muted num">
                    {e.mapMode.toUpperCase()} · 중심 {e.view.center[1].toFixed(1)}°, {e.view.center[0].toFixed(1)}° · 배율 {e.view.zoom.toFixed(1)}× · M{e.minMagnitude}+ · {e.timeWindow ? `${isoDateUtc(e.timeWindow.start)}~${isoDateUtc(e.timeWindow.end)}` : '전체 기간'}
                  </div>
                  <Button size="sm" variant="quiet" icon="trash" disabled={p.inputLocked} onClick={() => p.onEvidenceRemove(e.id)}>삭제</Button>
                </div>
              </div>
            ))}
          </section>
        </>
      ) : null}
    </div>
  )
}
