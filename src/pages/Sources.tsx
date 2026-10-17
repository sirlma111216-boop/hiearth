import { useEffect, useState } from 'react'
import { isoDateUtc, formatKst } from '@shared/geo/time'
import { TopBar } from '../ui/TopBar'
import type { LessonManifest } from '../data/lesson'

export default function Sources() {
  const [m, setM] = useState<LessonManifest | null>(null)
  useEffect(() => { fetch('/data/manifest.json').then((r) => r.json()).then(setM).catch(() => setM(null)) }, [])
  const eq = m?.datasets.earthquakesLesson
  return (
    <div className="page page-narrow prose">
      <TopBar />
      <span className="eyebrow">Data Sources</span>
      <h1 style={{ fontSize: 30, marginTop: 8 }}>자료 출처와 범위</h1>
      <p className="muted" style={{ marginTop: 10 }}>이 앱에서 보는 점과 선이 어디에서 왔는지, 무엇을 뜻하고 무엇을 뜻하지 않는지 정리했습니다.</p>

      <h2>지진 (관측 자료)</h2>
      <p>USGS Earthquake Hazards Program의 지진 목록(ComCat)을 FDSN Event 웹서비스로 받았습니다.</p>
      {eq ? <ul>
        <li>수업용 장기 자료: <span className="num">{isoDateUtc(Date.parse(eq.coverageStart!))} ~ {isoDateUtc(Date.parse(eq.coverageEnd!) - 1)} (UTC)</span>, 전 지구, 규모 <span className="num">{eq.filters.minmagnitude as number}</span> 이상, <span className="num">{eq.recordCount.toLocaleString()}</span>건</li>
        <li>자료 수집 시각: <span className="num">{formatKst(Date.parse(eq.retrievedAt))}</span> · 자료 버전 {eq.datasetVersion}</li>
        <li>제외 건수: {Object.entries(eq.rejected ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || '없음'} · 규모 없음 {(eq as unknown as { nullMagnitudeCount: number }).nullMagnitudeCount}건 · 깊이 없음 {(eq as unknown as { nullDepthCount: number }).nullDepthCount}건</li>
      </ul> : null}
      <ul>
        <li>최근 자료는 USGS 요약 피드(최근 30일/7일/24시간)를 서버가 10분 간격으로 받아 공유합니다. 즉각적인 지진 경보가 아닙니다.</li>
        <li>지진은 대체로 판의 경계 부근에 집중되지만 경계 밖에서도 발생합니다. 최근 지진이 없는 지역이 안전하다는 뜻이 아닙니다.</li>
        <li>관측망과 수록 기준의 차이 때문에 USGS 목록은 모든 지진의 완전한 기록이 아닙니다. 점의 크기는 규모 표시이며 피해 반경이 아닙니다.</li>
        <li>출처: <a href="https://earthquake.usgs.gov/fdsnws/event/1/" target="_blank" rel="noopener noreferrer">earthquake.usgs.gov/fdsnws/event/1/</a>, <a href="https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php" target="_blank" rel="noopener noreferrer">GeoJSON 요약 피드</a></li>
      </ul>

      <h2>화산 (목록 자료)</h2>
      <p>Smithsonian Institution Global Volcanism Program의 Holocene 화산 목록을 WFS로 받았습니다.</p>
      <ul>
        <li>{m ? <>수집 {isoDateUtc(Date.parse(m.datasets.volcanoes.retrievedAt))} · <span className="num">{m.datasets.volcanoes.recordCount.toLocaleString()}</span>개 · 레이어 {(m.datasets.volcanoes as unknown as { typeName: string }).typeName}</> : null}</li>
        <li>약 1만 년 안에 활동 흔적이 있는 화산의 위치입니다. '지금 분화 중인 화산 목록'이 아닙니다.</li>
        <li>지진과 화산의 자료 기간은 다르므로 같은 기간 발생 횟수로 비교하지 않습니다.</li>
        <li>출처: <a href="https://volcano.si.edu/database/webservices.cfm" target="_blank" rel="noopener noreferrer">volcano.si.edu 웹서비스</a>, <a href="https://volcano.si.edu/volcanolist_holocene.cfm" target="_blank" rel="noopener noreferrer">Holocene 목록</a>. 인용: Global Volcanism Program, Volcanoes of the World (Smithsonian Institution).</li>
      </ul>

      <h2>판 경계 (연구 모형)</h2>
      <ul>
        <li>USGS가 제공하는 판 경계 지도 서비스(eq/map_plateboundaries, 층 1 "Plates")를 받았습니다. {m ? <>수집 {isoDateUtc(Date.parse(m.datasets.plateBoundaries.retrievedAt))} · <span className="num">{m.datasets.plateBoundaries.recordCount}</span>개 선분</> : null}</li>
        <li>판 경계는 관측 기록이 아니라 연구 모형입니다. 앱은 유형을 구분하지 않은 한 종류의 선으로 보여 주며, 자료에 없는 이동 방향 화살표를 만들지 않습니다.</li>
        <li>학생의 선을 이 모형과 비교해 점수를 매기지 않습니다. 전체 의견 겹침은 '많은 학생이 같은 지역을 골랐다'는 뜻일 뿐 정답 확률이나 위험도가 아닙니다.</li>
        <li>출처: <a href="https://earthquake.usgs.gov/arcgis/rest/services/eq/map_plateboundaries/MapServer/1" target="_blank" rel="noopener noreferrer">USGS ArcGIS 서비스</a></li>
      </ul>

      <h2>지도 바탕</h2>
      <ul>
        <li>육지 모양은 Natural Earth(공공 영역) 자료를 TopoJSON으로 묶은 world-atlas {m?.datasets.land.packageVersion}를 사용합니다. 국가 경계와 국가 이름은 기본으로 표시하지 않습니다.</li>
        <li>화면의 배경 그림(랜딩, 서랍 표지, 보고서 표지)은 장식용 생성 이미지이며 지도·해안선·진원·화산·판 경계 자료가 아닙니다.</li>
        <li>출처: <a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noopener noreferrer">naturalearthdata.com</a></li>
      </ul>

      <h2>시간 재생이 뜻하는 것</h2>
      <p>재생은 관측 기록을 시간 순서로 보여 주는 것입니다. 지진 예측이나 지진파 전파 시뮬레이션이 아닙니다. 시각은 UTC로 저장하고 화면에는 한국 시간(KST)을 함께 표시합니다.</p>

      <h2>교육과정</h2>
      <p>2022 개정 중학교 과학 [9과09-05] 중 지진·화산 분포와 판의 경계 관련성에 초점을 둡니다. 이 앱 하나가 대륙이동설을 포함한 성취기준 전체를 가르친다고 주장하지 않습니다.</p>
    </div>
  )
}
