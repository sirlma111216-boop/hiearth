import { Link } from 'react-router-dom'
import { TopBar } from '../ui/TopBar'
import { LinkButton } from '../ui/Button'
import { useEffect, useState } from 'react'
import { isoDateUtc } from '@shared/geo/time'
import { LandingGlobe } from '../landing/LandingGlobe'

export default function Landing() {
  const [dataInfo, setDataInfo] = useState<{ retrievedAt: string; count: number; start: string; end: string; volcanoes: number; plates: number } | null>(null)
  const [globe, setGlobe] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => {
    fetch('/data/manifest.json').then((r) => r.json()).then((m) => {
      const eq = m.datasets.earthquakesLesson
      setDataInfo({ retrievedAt: eq.retrievedAt, count: eq.recordCount, start: eq.coverageStart, end: eq.coverageEnd, volcanoes: m.datasets.volcanoes.recordCount, plates: m.datasets.plateBoundaries.recordCount })
    }).catch(() => setDataInfo(null))
  }, [])
  return (
    <div className="landing">
      <TopBar />
      <section className={'landing-hero' + (globe === 'ready' ? ' is-3d' : '')} aria-labelledby="hero-title">
        {/* 레이어 1: 우주 배경(CSS) — 3D가 준비되면 정적 이미지 대신 이 위에 지구가 놓인다 */}
        <div className="hero-space" aria-hidden="true" />
        {/* 레이어 2: 정적 배경 이미지 — 먼저 보이고, 3D 준비 후 서서히 사라진다(지구 중복 방지) */}
        <picture>
          <source media="(max-width: 760px)" type="image/avif" srcSet="/images/landing-mobile.avif" />
          <source media="(max-width: 760px)" type="image/webp" srcSet="/images/landing-mobile.webp" />
          <source type="image/avif" srcSet="/images/landing-desktop.avif" />
          <source type="image/webp" srcSet="/images/landing-desktop.webp" />
          <img src="/images/landing-desktop.png" alt="" aria-hidden="true" fetchPriority="high" decoding="async" />
        </picture>
        {/* 레이어 3: 자전하는 3D 지구 (장식, 입력을 받지 않음) */}
        <LandingGlobe onStatus={setGlobe} />
        {/* 레이어 4: 가독성 그라데이션은 .landing-hero::after, 레이어 5: 실제 HTML 제목·버튼 */}
        <div className="hero-copy">
          <span className="eyebrow">Observe · Question · Discover</span>
          <h1 id="hero-title" className="hero-title">흩어진 점에서,<br /><em>지구의 경계를</em> 찾다.</h1>
          <p className="hero-sub">실제 지진과 화산 자료를 따라,<br />우리만의 설명을 만들어 보세요.</p>
          <div className="hero-actions">
            <LinkButton to="/explore" variant="primary" size="lg" iconRight="arrowRight">혼자 탐사하기</LinkButton>
            <LinkButton to="/join" variant="secondary" size="lg" icon="qr">탐사실 입장</LinkButton>
            <LinkButton to="/teach" variant="quiet" size="lg">교사로 시작</LinkButton>
          </div>
        </div>
        <div className="hero-foot">
          <span>지진 · 화산 · 판의 경계</span>
          <span>중학교 과학 [9과09-05] 참여형 탐구</span>
          <span>EARTH ATELIER</span>
        </div>
      </section>

      <section className="landing-section" aria-labelledby="scenes-title">
        <span className="eyebrow">Three Scenes</span>
        <h2 id="scenes-title" style={{ fontSize: 'clamp(26px, 3vw, 38px)', marginTop: 10 }}>관찰하고, 그리고, 증거로 고친다.</h2>
        <div className="scene-grid">
          <Link to="/explore" className="scene">
            <div className="scene-art"><img src="/images/evidence-seismic-960.webp" alt="" aria-hidden="true" loading="lazy" /></div>
            <div className="scene-body"><h3>관찰하기</h3><p>실제 지진 분포를 시간 순서로 재생하며, 점들이 어떤 띠를 이루는지 살펴봅니다.</p></div>
          </Link>
          <Link to="/explore" className="scene">
            <div className="scene-art"><img src="/images/workspace-atmosphere-960.webp" alt="" aria-hidden="true" loading="lazy" /></div>
            <div className="scene-body"><h3>추론 그리기</h3><p>판의 경계가 있을 것 같은 곳에 선을 긋습니다. 최초 추론은 그대로 기록됩니다.</p></div>
          </Link>
          <Link to="/explore" className="scene">
            <div className="scene-art"><img src="/images/evidence-volcano-960.webp" alt="" aria-hidden="true" loading="lazy" /></div>
            <div className="scene-body"><h3>증거로 수정하기</h3><p>화산 위치와 판 경계 모형을 열어 보고, 근거를 들어 설명을 고쳐 씁니다.</p></div>
          </Link>
        </div>
      </section>

      <footer className="landing-foot">
        <span>자료 제공: USGS Earthquake Hazards Program · Smithsonian Global Volcanism Program · Natural Earth · 배경 지구 표면: NASA Blue Marble</span>
        <span className="num">{dataInfo ? `수업용 자료 ${isoDateUtc(Date.parse(dataInfo.start))}~${isoDateUtc(Date.parse(dataInfo.end) - 1)} · 지진 ${dataInfo.count.toLocaleString()}건 · 화산 ${dataInfo.volcanoes.toLocaleString()}개 · 마지막 자료 확인 ${isoDateUtc(Date.parse(dataInfo.retrievedAt))}` : '자료 정보 확인 중'}</span>
        <span><Link to="/sources">자료 출처와 범위</Link> · <Link to="/settings">설정</Link> · <Link to="/showcase">시연 모드</Link></span>
      </footer>
    </div>
  )
}
