import type { Earthquake, Volcano } from '@shared/domain/types'
import { formatKst, formatUtc } from '@shared/geo/time'
import { Button } from '../ui/Button'

export function InfoPanel({ item, onClose }: { item: { kind: 'earthquake'; data: Earthquake } | { kind: 'volcano'; data: Volcano }; onClose: () => void }) {
  return (
    <aside className="panel info-panel" aria-live="polite">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        {item.kind === 'earthquake' ? (
          <h3>지진 · {item.data.place ?? '위치 설명 없음'}</h3>
        ) : (
          <h3>화산 · {item.data.name ?? `번호 ${item.data.number}`}</h3>
        )}
        <Button variant="quiet" size="sm" icon="close" onClick={onClose} aria-label="닫기" />
      </div>
      {item.kind === 'earthquake' ? (
        <dl className="num">
          <dt>발생 시각</dt><dd>{formatKst(item.data.time)}<br /><span className="muted">{formatUtc(item.data.time)}</span></dd>
          <dt>규모</dt><dd>{item.data.mag == null ? '자료 없음' : `M ${item.data.mag.toFixed(1)}`}</dd>
          <dt>깊이</dt><dd>{item.data.depth == null ? '자료 없음' : `${item.data.depth.toFixed(1)} km`}</dd>
          <dt>위치</dt><dd>{item.data.lat.toFixed(3)}°, {item.data.lon.toFixed(3)}°</dd>
          <dt>ID</dt><dd>{item.data.id}</dd>
          <dt>원문</dt><dd>{item.data.url ? <a href={item.data.url} target="_blank" rel="noopener noreferrer">USGS 사건 페이지</a> : '링크 없음'}</dd>
        </dl>
      ) : (
        <dl className="num">
          <dt>국가/지역</dt><dd>{item.data.country ?? '-'} · {item.data.region ?? '-'}</dd>
          <dt>유형</dt><dd>{item.data.type ?? '-'}</dd>
          <dt>마지막 분화 연도</dt><dd>{item.data.lastEruptionYear ?? '기록 없음'}</dd>
          <dt>높이</dt><dd>{item.data.elevation == null ? '-' : `${item.data.elevation} m`}</dd>
          <dt>위치</dt><dd>{item.data.lat.toFixed(3)}°, {item.data.lon.toFixed(3)}°</dd>
          <dt>원문</dt><dd><a href={`https://volcano.si.edu/volcano.cfm?vn=${item.data.number}`} target="_blank" rel="noopener noreferrer">GVP 화산 페이지</a></dd>
        </dl>
      )}
      <p className="tiny muted" style={{ marginTop: 8 }}>{item.kind === 'earthquake' ? '점의 크기는 규모 표시이며 피해 반경이나 지진파 범위가 아닙니다.' : 'Holocene 목록의 위치이며 현재 분화 중이라는 뜻이 아닙니다.'}</p>
    </aside>
  )
}
