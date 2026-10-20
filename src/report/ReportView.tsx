// 개인 탐구 보고서 — 탐구 질문 / 처음 생각 / 관찰 증거 / 수정한 생각 / 나의 설명 / 자료의 한계 / 출처
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { InquiryRecord } from '@shared/domain/types'
import { STAGE_INFO } from '@shared/domain/activity'
import { LESSON_SCREENS } from '@shared/domain/lesson'
import { formatKst, isoDateUtc } from '@shared/geo/time'
import type { LessonData } from '../data/lesson'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { renderStaticMap, viewForGuesses } from './staticMap'
import { downloadBlob, exportCardPng, exportRecordJson } from './exports'

interface Props {
  data: LessonData
  record: InquiryRecord
  nickname: string
  title: string
  roomCode?: string
  /** 로컬 보고서일 때 JSON 가져오기 처리 */
  onImport?: (file: File) => void
  backHref: string
}

export function ReportView({ data, record, nickname, title, roomCode, onImport, backHref }: Props) {
  const toast = useToast()
  const [maps, setMaps] = useState<{ first: string | null; revised: string | null } | null>(null)
  const view = useMemo(() => viewForGuesses([record.firstGuess?.guess ?? null, record.revisedGuess?.guess ?? null], 640, 400), [record.firstGuess, record.revisedGuess])
  useEffect(() => {
    // 캔버스 렌더는 메인 스레드를 잠깐 쓰므로 화면이 먼저 뜬 뒤에 그린다
    const t = setTimeout(() => {
      setMaps({
        first: renderStaticMap(data, record.firstGuess?.guess ?? null, 'first', view, 640, 400, { volcanoes: false, plates: false }),
        revised: renderStaticMap(data, record.revisedGuess?.guess ?? null, 'revised', view, 640, 400, { volcanoes: true, plates: true }),
      })
    }, 30)
    return () => clearTimeout(t)
  }, [data, record.firstGuess, record.revisedGuess, view])

  const m = data.manifest.datasets
  const eq = m.earthquakesLesson
  const datasetLine = `USGS ComCat ${isoDateUtc(Date.parse(eq.coverageStart!))}~${isoDateUtc(Date.parse(eq.coverageEnd!) - 1)} M${eq.filters.minmagnitude as number}+ ${eq.recordCount.toLocaleString()}건`
  const stagesVisited = record.history.map((h) => STAGE_INFO[h.stage].short)
  const lastStage = STAGE_INFO[record.stage]

  const savePng = async () => {
    const blob = await exportCardPng({
      title, nickname, firstImg: maps?.first ?? null, revisedImg: maps?.revised ?? null,
      explanation: record.explanation?.text ?? '', limitations: record.explanation?.limitations ?? '', evidenceCount: record.evidence.length,
      datasetLine, sourcesLine: 'GVP Holocene · USGS 판 경계 모형 · Natural Earth',
    })
    if (!blob) { toast.push('탐구 카드 이미지를 만들지 못했습니다.', 'danger'); return }
    downloadBlob(`earth-expedition-card-${roomCode ?? 'local'}.png`, blob)
  }

  return (
    <article className="report">
      <div className="report-cover">
        <img src="/images/report-cover.webp" alt="" aria-hidden="true" />
        <div className="cover-text">
          <span className="eyebrow">Inquiry Portfolio</span>
          <h1>{title}</h1>
          <p className="muted small" style={{ marginTop: 6 }}>{nickname} · {roomCode ? `탐사실 ${roomCode}` : '혼자 탐사'} · 마지막 활동: {lastStage.short}</p>
        </div>
      </div>

      <div className="row no-print" style={{ gap: 8 }}>
        <Button variant="primary" icon="print" onClick={() => window.print()}>인쇄 / PDF 저장</Button>
        <Button variant="secondary" icon="download" onClick={() => void savePng()} disabledReason={!maps ? '지도를 그리는 중입니다' : undefined}>PNG 탐구 카드</Button>
        <Button variant="secondary" icon="download" onClick={() => exportRecordJson(record, { nickname, roomCode, title })}>JSON 내보내기</Button>
        {onImport ? (
          <label className="btn btn-secondary">
            <input type="file" accept="application/json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.currentTarget.value = '' }} />
            JSON 가져오기
          </label>
        ) : null}
        <Link to={backHref} className="btn btn-quiet">돌아가기</Link>
      </div>

      <section>
        <h2><span className="no">01</span> 탐구 질문</h2>
        <ul className="prose" style={{ paddingLeft: 20 }}>
          <li>지진은 어디에 집중되어 있는가? 어떤 띠를 이루는가?</li>
          <li>화산의 분포는 지진의 분포와 어떤 공통점이 있는가?</li>
          <li>지진·화산의 분포는 판의 경계와 어떻게 관련되는가?</li>
        </ul>
      </section>

      <section>
        <h2><span className="no">02</span> 처음 생각 (최초 추론)</h2>
        {record.firstGuess ? <p className="muted small num">선 {record.firstGuess.guess.lines.length}개 · 제출 {formatKst(record.firstGuess.submittedAt)} · 자료 {record.firstGuess.datasetVersion}</p> : <p className="report-empty">아직 제출하지 않음</p>}
      </section>

      <section>
        <h2><span className="no">03</span> 관찰 증거 <span className="muted small num">{record.evidence.length}개</span></h2>
        {record.evidence.length ? (
          <div className="evidence-grid">
            {record.evidence.map((e, i) => (
              <figure key={e.id} className="evidence-card" style={{ margin: 0 }}>
                {e.capture ? <img src={e.capture} alt={`관찰 증거 ${i + 1}: ${e.title || '제목 없음'}`} /> : <div style={{ height: 150, display: 'grid', placeItems: 'center', background: 'var(--raised)' }} className="muted small">캡처 없음 (조건만 저장)</div>}
                <figcaption className="body">
                  <strong>{i + 1}. {e.title || '제목 없음'}</strong>
                  <p>{e.note || <span className="report-empty">메모 없음</span>}</p>
                  <dl className="num">
                    <dt>지도</dt><dd>{e.mapMode.toUpperCase()} · 중심 {e.view.center[1].toFixed(1)}°, {e.view.center[0].toFixed(1)}° · 배율 {e.view.zoom.toFixed(1)}×</dd>
                    <dt>기간</dt><dd>{e.timeWindow ? `${isoDateUtc(e.timeWindow.start)} ~ ${isoDateUtc(e.timeWindow.end)} UTC` : '전체 기간'}</dd>
                    <dt>조건</dt><dd>규모 {e.minMagnitude}+ · 레이어 {e.layers.join(', ')}</dd>
                    {e.selectedEventIds.length ? <><dt>선택 사건</dt><dd>{e.selectedEventIds.join(', ')}</dd></> : null}
                    <dt>자료 버전</dt><dd>{e.datasetVersion}</dd>
                  </dl>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : <p className="report-empty">담아 둔 관찰 증거가 없음</p>}
      </section>

      {record.responses && Object.keys(record.responses).length ? (
        <section>
          <h2><span className="no">03+</span> 관찰 기록과 자기 분석</h2>
          <table className="data">
            <tbody>
              {LESSON_SCREENS.filter((s) => record.responses?.[s.id] && ((record.responses[s.id].text ?? '').trim() || record.responses[s.id].choices?.length)).map((s) => { const r = record.responses![s.id]; return (
                <tr key={s.id}><th style={{ width: '32%' }}>{s.step}. {s.title}</th><td>{r.choices?.length ? <div className="small muted">{r.choices.join(' · ')}</div> : null}{r.text?.trim() ? <div style={{ whiteSpace: 'pre-wrap' }}>{r.text}</div> : null}</td></tr>
              ) })}
            </tbody>
          </table>
        </section>
      ) : null}

      <section>
        <h2><span className="no">04</span> 수정한 생각 (수정 추론)</h2>
        {record.revisedGuess ? <p className="muted small num">선 {record.revisedGuess.guess.lines.length}개 · 제출 {formatKst(record.revisedGuess.submittedAt)}</p> : <p className="report-empty">아직 제출하지 않음</p>}
        <div className="report-maps" style={{ marginTop: 12 }}>
          <figure className="report-map" style={{ margin: 0 }}>
            {maps?.first ? <img src={maps.first} alt="최초 추론 지도: 지진 분포와 처음 그린 선" /> : <div style={{ aspectRatio: '16/10' }} />}
            <figcaption>처음 생각 · 흰 실선 (지진만 표시)</figcaption>
          </figure>
          <figure className="report-map" style={{ margin: 0 }}>
            {maps?.revised ? <img src={maps.revised} alt="수정 추론 지도: 지진·화산·판 경계 모형과 수정한 선" /> : <div style={{ aspectRatio: '16/10' }} />}
            <figcaption>수정한 생각 · 하늘색 점선 (화산·판 경계 모형 함께 표시)</figcaption>
          </figure>
        </div>
        <p className="tiny muted" style={{ marginTop: 6 }}>두 지도는 같은 중심과 배율로 그렸습니다. 지도는 저장된 좌표 자료로 다시 그린 것입니다.</p>
      </section>

      <section>
        <h2><span className="no">05</span> 나의 설명</h2>
        {record.explanation?.text.trim() ? <div className="report-quote">{record.explanation.text}</div> : <p className="report-empty">아직 작성하지 않음</p>}
      </section>

      <section>
        <h2><span className="no">06</span> 자료의 한계</h2>
        {record.explanation?.limitations.trim() ? <div className="report-quote">{record.explanation.limitations}</div> : <p className="report-empty">아직 작성하지 않음</p>}
        <ul className="prose small muted" style={{ paddingLeft: 20, marginTop: 12 }}>
          <li>지진 자료는 규모 {eq.filters.minmagnitude as number} 이상만 포함하며, USGS 목록은 모든 지진의 완전한 기록이 아닙니다.</li>
          <li>화산 목록은 Holocene 활동 기록이 있는 화산의 위치이며 지금 분화 중인 목록이 아닙니다. 지진 자료와 기간이 다릅니다.</li>
          <li>판 경계 선은 연구 모형입니다. 학생의 선을 점수로 평가하지 않습니다.</li>
        </ul>
      </section>

      <section>
        <h2><span className="no">07</span> 출처</h2>
        <table className="data">
          <tbody>
            <tr><th>지진</th><td>{eq.provider} · {datasetLine} · 수집 {isoDateUtc(Date.parse(eq.retrievedAt))} · <a href="https://earthquake.usgs.gov/fdsnws/event/1/" target="_blank" rel="noopener noreferrer">earthquake.usgs.gov</a></td></tr>
            <tr><th>화산</th><td>{m.volcanoes.provider} · {m.volcanoes.recordCount}개 · 수집 {isoDateUtc(Date.parse(m.volcanoes.retrievedAt))} · <a href="https://volcano.si.edu/" target="_blank" rel="noopener noreferrer">volcano.si.edu</a></td></tr>
            <tr><th>판 경계</th><td>{m.plateBoundaries.provider} · {m.plateBoundaries.recordCount}개 선분 · 수집 {isoDateUtc(Date.parse(m.plateBoundaries.retrievedAt))}</td></tr>
            <tr><th>지도</th><td>Natural Earth (public domain), world-atlas {m.land.packageVersion}</td></tr>
            <tr><th>활동 기록</th><td className="num">{stagesVisited.join(' → ')}</td></tr>
          </tbody>
        </table>
      </section>
    </article>
  )
}
