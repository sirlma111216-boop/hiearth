import { Button } from '../ui/Button'

export function RevealScene({ kind, onClose, versionText }: { kind: 'volcano' | 'boundary'; onClose: () => void; versionText: string }) {
  const volcano = kind === 'volcano'
  return (
    <div className="reveal-scene" role="dialog" aria-modal="true" aria-labelledby="reveal-title">
      <div className="reveal-card">
        <img src={volcano ? '/images/evidence-volcano.webp' : '/images/report-cover.webp'} alt="" aria-hidden="true" />
        <div className="body stack">
          <span className="eyebrow">{volcano ? 'NEW EVIDENCE' : 'RESEARCH MODEL'}</span>
          <h2 id="reveal-title" style={{ fontSize: 22 }}>{volcano ? '새로운 증거가 도착했습니다: 화산의 위치' : '연구 모형의 판 경계를 공개합니다'}</h2>
          <p className="muted">
            {volcano
              ? '지도에 화산 위치(삼각형)가 추가됩니다. 이 그림은 장식 이미지이며 특정 화산의 사진이 아닙니다.'
              : '판 경계 선은 연구자들이 만든 모형입니다. 내 선과 겹치는 곳과 어긋나는 곳, 경계 밖의 지진을 찾아보세요. 점수를 매기지 않습니다.'}
          </p>
          <p className="tiny muted">{versionText}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="primary" onClick={onClose} icon="check">지도에서 확인하기</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
