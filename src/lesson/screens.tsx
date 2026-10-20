// 수업 화면 내용 — 화면 id별 본문. 번호는 shared/domain/lesson.ts 표에서만 온다.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { InquiryRecord, ScreenResponse } from '@shared/domain/types'
import { isoDateUtc, formatKst } from '@shared/geo/time'
import type { LessonData } from '../data/lesson'
import { Button } from '../ui/Button'
import { renderStaticMap, viewForGuesses } from '../report/staticMap'
import { exportRecordJson } from '../report/exports'
import type { ActivityTask } from './ActivityFrame'

export interface ScreenCtx {
  data: LessonData
  record: InquiryRecord
  role: 'solo' | 'student' | 'teacher'
  classroom: boolean
  inputLocked: boolean
  response: ScreenResponse | undefined
  setResponse: (patch: { text?: string; choices?: string[] }) => void
  onExplanation: (text: string, limitations: string) => void
  explanationDraft?: { text?: string; limitations?: string }
  onExplanationDraft: (field: 'text' | 'limitations', value: string) => void
  goNext: () => void
  reportHref?: string
  nickname?: string
}

// ---------------- 활동 화면 과제 정의 ----------------
export const ACTIVITY_TASKS: Record<string, ActivityTask> = {
  'observe-world': {
    question: '지진은 지구 어디에 모여 있을까?',
    hint: '지구본을 돌리고 확대해 보세요. 점 하나가 지진 한 번입니다. 고르게 퍼져 있나요, 어딘가에 몰려 있나요?',
    steps: ['지구본을 한 바퀴 돌려 보기', '점이 많이 모인 곳 찾기'],
    panels: { tools: false, time: false, evidence: true },
    initialLayers: { earthquakes: true, volcanoes: false, plates: false },
    notePrompt: '점이 가장 많이 모인 곳은 어디인가요? 어떤 모양으로 모여 있나요?',
    choices: { prompt: '지진은 어떻게 분포해 있나요? (해당하는 것 모두)', options: ['지구 전체에 고르게 퍼져 있다', '특정한 곳에 띠처럼 길게 이어진다', '바다 한가운데에도 있다', '대륙 안쪽에는 거의 없다', '우리나라 근처에도 있다'] },
    teacherTip: '"고르게 퍼져 있나요?"라고 먼저 물어 "띠"라는 말이 학생 입에서 나오게 합니다. 태평양 중심 보기로 돌려 보여 주면 띠가 한눈에 들어옵니다.',
  },
  'observe-time': {
    startTimeAtBeginning: true,
    question: '시간을 돌리면 띠가 어떻게 드러날까?',
    hint: '재생을 누르면 10년 동안의 지진이 시간 순서로 쌓입니다. 처음에는 흩어져 보이던 점이 어느 순간 띠가 되는지 지켜보세요.',
    steps: ['처음으로 되감고 재생하기', '누적과 이동 시간창을 바꿔 보기'],
    panels: { tools: false, evidence: false, time: true },
    initialLayers: { earthquakes: true },
    notePrompt: '짧은 기간만 보면 어땠고, 기간이 길어지면 무엇이 보였나요?',
    teacherTip: '"이동 시간창 30일"로 바꾸면 띠가 사라지고 점만 남습니다. 긴 기록이 왜 필요한지 이야기할 기회입니다. 재생은 예측이 아니라 기록의 재생임을 짚어 주세요.',
  },
  'observe-close': {
    question: '가까이 보면 띠는 어떤 모양일까?',
    hint: '위치 이동에서 일본 주변, 남아메리카 서안, 대서양 중앙부를 차례로 가 보세요. 마음에 드는 장면은 "지금 화면 담기"로 증거로 남겨 둡니다.',
    steps: ['세 지역을 둘러보기', '관찰 증거 1개 이상 담기'],
    panels: { tools: false, time: true, evidence: true },
    initialLayers: { earthquakes: true },
    notePrompt: '세 지역의 띠는 서로 어떻게 다른가요? (굵기, 모양, 육지와의 관계)',
    teacherTip: '점을 누르면 규모·깊이·원문 링크가 보입니다. "바다 한가운데 대서양에 왜 줄이 있을까?"를 질문으로 남겨 두면 판의 경계 단계에서 이어집니다.',
  },
  'guess-draw': {
    question: '판의 경계가 있을 것 같은 곳에 선을 그려 보세요',
    hint: '지진이 띠를 이루는 곳을 따라 선을 긋습니다. 정답을 맞히는 활동이 아니라, 지금 생각을 기록하는 활동입니다. 제출하면 최초 추론으로 남고 바뀌지 않습니다.',
    steps: ['그리기 모드로 바꾸기', '선 1개 이상 그리기', '최초 추론 제출'],
    panels: { tools: true, evidence: true, time: false },
    initialLayers: { earthquakes: true },
    teacherTip: '5~7분을 주고 "입력 잠금"으로 마감합니다. 참가 현황의 1번 표시로 제출을 확인하세요.',
  },
  'reveal-lines': {
    question: '우리가 그린 선은 어디에서 겹칠까?',
    hint: '모두의 선이 회색으로 겹쳐 보입니다. 많이 겹친 곳은 "많은 사람이 같은 곳을 골랐다"는 뜻이지, 정답이거나 위험한 곳이라는 뜻이 아닙니다.',
    steps: ['겹친 곳 찾기', '갈린 곳 찾기'],
    panels: { tools: false, time: false, evidence: true },
    initialLayers: { earthquakes: true, others: true, myFirst: true },
    notePrompt: '선이 가장 많이 겹친 곳과 가장 갈린 곳은 어디인가요?',
    teacherTip: '두 학생을 "비교 강조"로 골라 왜 다르게 그렸는지 발표시켜 보세요. "의견 겹침 강조"를 켜면 몰린 곳이 진해집니다.',
  },
  'volcano-open': {
    question: '새 증거가 도착했습니다: 화산의 위치',
    hint: '지도에 화산(삼각형)이 나타납니다. 이 목록은 지금 분화 중인 화산이 아니라, 약 1만 년 안에 활동한 흔적이 있는 화산의 위치입니다.',
    steps: ['화산 레이어 확인하기'],
    panels: { tools: false, time: false, evidence: true },
    initialLayers: { earthquakes: true, volcanoes: true },
    reveal: 'volcano',
    choices: { prompt: '첫인상은 어떤가요?', options: ['지진 띠와 거의 같은 곳에 있다', '지진 띠와 다른 곳에도 많다', '바다 한가운데 띠에는 화산이 적다', '우리나라 근처에는 화산이 적다'] },
    teacherTip: '이 화면을 열면 학생 화면에 증거 카드가 뜹니다. 카드를 닫게 한 뒤 삼각형이 어디에 모이는지 말하게 하세요.',
  },
  'volcano-compare': {
    question: '지진 띠와 화산은 어디에서 겹치고, 어디에서 다를까?',
    hint: '지진 레이어를 껐다 켜며 비교해 보세요. 겹치는 곳과 겹치지 않는 곳을 하나씩 찾아 증거로 담아 둡니다.',
    steps: ['겹치는 곳 1곳 증거 담기', '겹치지 않는 곳 1곳 찾기'],
    panels: { tools: false, time: false, evidence: true },
    initialLayers: { earthquakes: true, volcanoes: true },
    notePrompt: '지진은 있는데 화산이 없는 곳, 또는 그 반대인 곳이 있나요? 어디인가요?',
    teacherTip: '"대서양 가운데 줄에는 왜 화산이 적게 보일까?"(바다 밑이라 목록에 적다)와 "하와이는 띠 밖인데 왜 화산일까?"는 뒤 단계 이야깃거리로 남겨 둡니다.',
  },
  'revise-draw': {
    question: '화산 증거를 반영해 선을 고쳐 보세요',
    hint: '최초 추론이 초안으로 복사되어 있습니다. 고칠 곳만 고치고 제출하세요. 최초 기록은 그대로 남고, 수정 추론은 따로 저장됩니다.',
    steps: ['고칠 곳 정하기', '수정 추론 제출'],
    panels: { tools: true, evidence: true, time: false },
    initialLayers: { earthquakes: true, volcanoes: true, myFirst: true },
    teacherTip: '바꾸지 않은 학생도 괜찮습니다. "왜 안 바꿨는지"도 근거입니다.',
  },
  'plate-open': {
    question: '연구자들이 만든 판 경계 모형과 비교해 봅시다',
    hint: '판 경계는 관측 기록이 아니라 연구 모형입니다. 내 선과 겹치는 곳, 어긋나는 곳, 그리고 경계 밖에서 일어난 지진을 찾아보세요. 점수를 매기지 않습니다.',
    steps: ['판 경계 레이어 확인', '내 선과 겹치는 곳 찾기', '경계 밖 지진 찾기'],
    panels: { tools: false, time: false, evidence: true },
    initialLayers: { earthquakes: true, volcanoes: true, plates: true, myFirst: true, myRevised: true },
    reveal: 'boundary',
    teacherTip: '레이어를 하나씩 끄고 켜며 "지진 → 화산 → 경계" 순서로 쌓아 보여 주면 관련성이 또렷해집니다.',
  },
}

// ---------------- 보조 조각 ----------------
function Narrative({ lines, onDone }: { lines: string[]; onDone: () => void }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (n >= lines.length) return
    const t = setTimeout(() => setN((v) => v + 1), n === 0 ? 400 : 1700)
    return () => clearTimeout(t)
  }, [n, lines.length])
  const advance = () => { if (n < lines.length) setN(lines.length); else onDone() }
  return (
    <div className="screen-card is-narrative" onClick={advance} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advance() } }} aria-label="화면을 누르면 다음 문장으로 넘어갑니다">
      <div>
        <div className="narr-lines">
          {lines.map((l, i) => <p key={i} className={i < n ? (i < n - 1 ? 'is-on is-dim' : 'is-on') : ''}>{l}</p>)}
        </div>
        <p className="narr-hint">{n < lines.length ? '화면을 누르면 바로 넘어갑니다' : '한 번 더 누르면 시작합니다'}</p>
        {n >= lines.length ? <div style={{ marginTop: 16 }}><Button variant="primary" size="lg" iconRight="arrowRight" onClick={(e) => { e.stopPropagation(); onDone() }}>시작하기</Button></div> : null}
      </div>
    </div>
  )
}

function Card({ children, title }: { children: ReactNode; kicker?: string; title?: string }) {
  return (
    <>
      {title ? <div className="screen-head"><div><h1>{title}</h1></div></div> : null}
      <div className="screen-card">{children}</div>
    </>
  )
}

function Choices({ prompt, options, ctx, multi = true }: { prompt: string; options: string[]; ctx: ScreenCtx; multi?: boolean }) {
  const chosen = ctx.response?.choices ?? []
  const toggle = (o: string) => ctx.setResponse({ choices: chosen.includes(o) ? chosen.filter((c) => c !== o) : multi ? [...chosen, o] : [o] })
  if (ctx.role === 'teacher') return <div className="teacher-hint"><strong>학생 화면의 질문</strong> {prompt} — {options.join(' / ')}</div>
  return (
    <div className="response">
      <div className="label">{prompt}</div>
      <div className="choice-grid" role="group" aria-label={prompt}>
        {options.map((o) => <label key={o} className={'choice' + (chosen.includes(o) ? ' is-on' : '')}><input type={multi ? 'checkbox' : 'radio'} disabled={ctx.inputLocked} checked={chosen.includes(o)} onChange={() => toggle(o)} /><span>{o}</span></label>)}
      </div>
    </div>
  )
}

function Note({ prompt, ctx, rows = 3 }: { prompt: string; ctx: ScreenCtx; rows?: number }) {
  if (ctx.role === 'teacher') return <div className="teacher-hint"><strong>학생 메모 질문</strong> {prompt}</div>
  return (
    <div className="response">
      <label className="label" htmlFor={'note-' + prompt.length}>{prompt}</label>
      <textarea id={'note-' + prompt.length} className="textarea" disabled={ctx.inputLocked} style={{ minHeight: rows * 28 }} maxLength={600} value={ctx.response?.text ?? ''} onChange={(e) => ctx.setResponse({ text: e.target.value })} placeholder="한두 문장이면 충분합니다." />
    </div>
  )
}

function MiniMap({ ctx, kind, withVolcano, withPlates, caption }: { ctx: ScreenCtx; kind: 'first' | 'revised'; withVolcano?: boolean; withPlates?: boolean; caption: string }) {
  const guess = kind === 'first' ? ctx.record.firstGuess?.guess ?? null : ctx.record.revisedGuess?.guess ?? null
  const view = useMemo(() => viewForGuesses([ctx.record.firstGuess?.guess ?? null, ctx.record.revisedGuess?.guess ?? null], 640, 400), [ctx.record.firstGuess, ctx.record.revisedGuess])
  const [img, setImg] = useState<string | null>(null)
  useEffect(() => { const t = setTimeout(() => setImg(renderStaticMap(ctx.data, guess, kind, view, 640, 400, { volcanoes: withVolcano, plates: withPlates })), 20); return () => clearTimeout(t) }, [ctx.data, guess, kind, view, withVolcano, withPlates])
  return (
    <figure className="mini-map" style={{ margin: 0 }}>
      {img ? <img src={img} alt={caption} /> : <div style={{ aspectRatio: '16/10' }} />}
      <figcaption className="tiny muted" style={{ padding: '6px 10px' }}>{caption}{!guess ? ' · 아직 제출한 선이 없음' : ''}</figcaption>
    </figure>
  )
}

function EvidenceStrip({ ctx }: { ctx: ScreenCtx }) {
  const ev = ctx.record.evidence
  if (!ev.length) return <p className="hint">담아 둔 관찰 증거가 없습니다. 활동 화면의 "지금 화면 담기"로 남길 수 있습니다.</p>
  return (
    <div className="evidence-strip">
      {ev.map((e, i) => <figure key={e.id}>{e.capture ? <img src={e.capture} alt={`증거 ${i + 1}`} /> : <div style={{ height: 110, background: 'var(--raised)' }} />}<figcaption>{i + 1}. {e.title || '제목 없음'}{e.note ? ` — ${e.note}` : ''}</figcaption></figure>)}
    </div>
  )
}

const sr = (ms: string | null | undefined) => (ms ? isoDateUtc(Date.parse(ms)) : '')

// ---------------- 화면 본문 ----------------
export function renderScreen(id: string, ctx: ScreenCtx): ReactNode {
  const m = ctx.data.manifest.datasets
  const eq = m.earthquakesLesson
  switch (id) {
    case 'intro':
      return <Narrative onDone={ctx.goNext} lines={['지구는 조용해 보입니다.', '하지만 지구 어딘가에서는 하루에도 수십 번 땅이 흔들립니다.', '사람들은 그 흔들림을 하나하나 기록해 두었습니다.', `10년 동안 모인 기록, ${eq.recordCount.toLocaleString()}개의 점.`, '그 점들 속에, 지구의 경계가 숨어 있습니다.']} />
    case 'intro-questions':
      return (
        <Card kicker="Today" title="오늘의 탐구 질문">
          <div className="prose-lg">
            <p>오늘 우리는 <em>실제 관측 자료</em>를 보고, 지구의 판이 어디에서 만나는지 <em>스스로 추론</em>합니다. 정답을 외우는 시간이 아니라, 증거를 보고 생각을 만들고 고치는 시간입니다.</p>
          </div>
          <ol className="q-list">
            <li><span className="q-no">Q1</span><span>지진은 어디에 집중되어 있는가? 어떤 띠를 이루는가?</span></li>
            <li><span className="q-no">Q2</span><span>화산의 분포는 지진의 분포와 어떤 공통점이 있는가?</span></li>
            <li><span className="q-no">Q3</span><span>지진과 화산의 분포는 판의 경계와 어떻게 관련되는가?</span></li>
          </ol>
          <div className="callout brass"><strong>오늘 하게 될 일</strong>지진 관찰 → 경계 선 긋기(최초 추론) → 화산 증거 보기 → 선 고치기(수정 추론) → 판 경계 모형과 비교 → 근거 있는 설명 쓰기. 처음 그린 선은 지우지 않고 남겨 둡니다. 생각이 어떻게 바뀌었는지가 오늘의 결과물입니다.</div>
          {ctx.classroom ? <p className="hint" style={{ marginTop: 12 }}>선생님이 화면을 넘기면 함께 넘어갑니다. 활동 화면에서는 각자 속도로 할 수 있습니다.</p> : null}
        </Card>
      )
    case 'quake-what':
      return (
        <Card kicker="Step 2 · 1" title="지진은 무엇일까">
          <div className="screen-grid">
            <div className="prose-lg">
              <p>지진은 땅속 깊은 곳에서 <em>암석이 갑자기 미끄러지거나 깨지면서</em> 생긴 흔들림이 사방으로 퍼져 나가는 현상입니다.</p>
              <p>흔들림이 시작된 땅속의 지점을 <mark>진원</mark>, 그 바로 위 지표면을 <mark>진앙</mark>이라고 합니다. 지도 위의 점은 진앙의 위치입니다.</p>
              <p>지진은 아주 작은 것부터 큰 것까지 끊임없이 일어납니다. 전 세계 관측소가 그 흔들림을 재어 <em>언제, 어디서, 얼마나 크게</em> 일어났는지 기록합니다.</p>
            </div>
            <figure><img src="/images/evidence-seismic-960.webp" alt="" aria-hidden="true" /><figcaption>장식 이미지 — 실제 지진계나 관측 자료가 아닙니다.</figcaption></figure>
          </div>
        </Card>
      )
    case 'quake-dot':
      return (
        <Card kicker="Step 2 · 2" title="점 하나는 무엇을 뜻할까">
          <div className="prose-lg">
            <p>이제부터 보게 될 지도의 <em>점 하나는 지진 한 번</em>입니다. 점의 위치는 진앙, 점의 크기는 <mark>규모</mark>를 나타냅니다.</p>
            <p>규모는 지진이 내놓은 에너지의 크기를 숫자로 나타낸 것입니다. 숫자가 1 커질 때 에너지는 약 32배가 됩니다. 규모 5와 규모 7은 "두 단계"가 아니라 약 1,000배 차이입니다.</p>
            <p>점을 누르면 <em>발생 시각, 규모, 깊이, 원래 기록으로 가는 링크</em>가 보입니다.</p>
          </div>
          <div className="callout"><strong>주의해서 읽기</strong>점의 크기는 규모를 나타낼 뿐, 피해를 입은 범위나 지진파가 퍼진 범위가 아닙니다. 점이 없는 곳이 "안전한 곳"이라는 뜻도 아닙니다. 최근 10년 동안 큰 지진이 없었을 뿐입니다.</div>
        </Card>
      )
    case 'quake-data':
      return (
        <Card kicker="Step 2 · 3" title="우리가 쓰는 자료">
          <div className="prose-lg">
            <p>오늘 보는 지진 자료는 미국 지질조사국(USGS)이 전 세계 관측소의 기록을 모아 공개한 목록입니다.</p>
          </div>
          <table className="data" style={{ marginTop: 16 }}>
            <tbody>
              <tr><th>기간</th><td className="num">{sr(eq.coverageStart)} ~ {eq.coverageEnd ? isoDateUtc(Date.parse(eq.coverageEnd) - 1) : ''} (UTC, 10년)</td></tr>
              <tr><th>범위</th><td>전 지구, 규모 {eq.filters.minmagnitude as number} 이상</td></tr>
              <tr><th>개수</th><td className="num">{eq.recordCount.toLocaleString()}건</td></tr>
              <tr><th>가져온 날</th><td className="num">{sr(eq.retrievedAt)}</td></tr>
            </tbody>
          </table>
          <div className="callout brass"><strong>자료에는 한계가 있습니다</strong>규모 5.0보다 작은 지진은 넣지 않았으므로 작은 지진이 많은 곳은 비어 보일 수 있습니다. 관측소가 적은 바다 한가운데는 작은 지진이 기록되지 않기도 합니다. 그래서 이 목록은 "모든 지진"이 아니라 "기록된 지진"입니다.</div>
          <p className="hint" style={{ marginTop: 12 }}>자세한 출처와 조건은 <Link to="/sources">자료 출처와 범위</Link>에 있습니다.</p>
        </Card>
      )
    case 'guess-howto':
      return (
        <Card kicker="Step 4 · 1" title="선을 긋는 방법">
          <div className="screen-grid">
            <div className="prose-lg">
              <p>다음 화면에서 <em>판의 경계가 있을 것 같은 곳</em>에 선을 긋습니다. 지진이 띠처럼 이어진 곳을 따라 그으면 됩니다.</p>
              <p>오른쪽 도구에서 <mark>그리기</mark>를 누르고, 지도 위를 손가락이나 마우스로 끌면 선이 그려집니다. 점을 하나씩 찍고 싶으면 <mark>꼭짓점 찍기</mark>를 고르세요.</p>
              <p>선은 여러 개 그려도 됩니다. 잘못 그었으면 되돌리기, 전체 지우기를 쓰세요. 다 그렸으면 <em>최초 추론 제출</em>을 누릅니다.</p>
            </div>
            <div>
              <div className="callout"><strong>정답을 맞히는 활동이 아닙니다</strong>지금 생각을 솔직하게 기록하는 것이 목적입니다. 제출한 최초 추론은 나중에 고칠 수 없지만, 화산 증거를 본 뒤 "수정 추론"을 따로 제출합니다. 처음과 나중의 차이가 오늘의 공부입니다.</div>
              <div className="callout brass"><strong>팁</strong>3D 지구본이 어렵다면 왼쪽 위 버튼으로 2D 지도로 바꿔 그리세요. 두 손가락으로 지도를 움직이고, 한 손가락으로 그립니다.</div>
            </div>
          </div>
        </Card>
      )
    case 'reveal-reflect':
      return (
        <Card kicker="Step 5 · 2" title="내 선 돌아보기">
          <div className="screen-grid">
            <MiniMap ctx={ctx} kind="first" caption="내가 제출한 최초 추론 (흰 실선)과 지진 분포" />
            <div>
              <div className="prose-lg"><p>내가 그린 선을 지진 분포 위에서 다시 봅니다. 선을 그을 때는 몰랐던 것이 보일 수 있습니다.</p></div>
              <Choices ctx={ctx} prompt="내 선을 보며 해당하는 것을 모두 고르세요" options={['지진 띠를 잘 따라간 구간이 있다', '지진이 거의 없는 곳을 지나는 구간이 있다', '띠가 있는데 선을 긋지 않은 곳이 있다', '선이 띠보다 훨씬 굵거나 대충 그어졌다', ctx.classroom ? '다른 친구들과 겹친 곳이 많다' : '지도를 더 확대해서 볼 걸 그랬다']} />
              <Note ctx={ctx} prompt="고치고 싶은 곳이 있다면 어디이고, 왜 그런가요? (아직 고치지 않습니다)" />
            </div>
          </div>
        </Card>
      )
    case 'volcano-what':
      return (
        <Card kicker="Step 6 · 1" title="화산은 어디에 있을까">
          <div className="screen-grid">
            <figure><img src="/images/evidence-volcano-960.webp" alt="" aria-hidden="true" /><figcaption>장식 이미지 — 특정 화산의 사진이 아닙니다.</figcaption></figure>
            <div className="prose-lg">
              <p>화산은 땅속의 <em>마그마</em>가 지표로 올라와 터져 나오는 곳입니다. 지진처럼 화산도 아무 데나 있지 않습니다.</p>
              <p>다음 화면에서 받을 자료는 스미스소니언 연구소가 정리한 <mark>약 1만 년 안에 활동 흔적이 있는 화산</mark> {m.volcanoes.recordCount.toLocaleString()}개의 위치입니다.</p>
              <p>이 목록은 "지금 분화 중인 화산"이 아닙니다. 또 지진 자료(10년)와 화산 자료(1만 년)는 기간이 전혀 다르므로 <em>개수를 비교하면 안 됩니다</em>. 비교할 것은 <em>어디에 있는가</em>입니다.</p>
            </div>
          </div>
          <div className="callout"><strong>생각해 볼 것</strong>지진 띠와 화산이 같은 곳에 있다면 무엇을 뜻할까요? 다른 곳에 있다면요? 다음 화면에서 직접 확인합니다.</div>
        </Card>
      )
    case 'revise-why':
      return (
        <Card kicker="Step 7 · 1" title="생각을 고치는 것은 실력이다">
          <div className="prose-lg">
            <p>과학자는 처음 생각을 끝까지 지키는 사람이 아니라, <em>새 증거가 오면 생각을 고치는 사람</em>입니다. 앞에서 그린 선은 지진만 보고 그은 것입니다. 이제 화산이라는 두 번째 증거가 있습니다.</p>
            <p>다음 화면에는 최초 추론이 초안으로 복사되어 있습니다. <mark>고칠 곳만 고치고</mark> 수정 추론을 제출하세요. 최초 기록은 그대로 남습니다.</p>
            <p>바꿀 이유가 없다면 그대로 제출해도 됩니다. "왜 바꾸지 않았는가"도 근거입니다.</p>
          </div>
          <Choices ctx={ctx} multi={false} prompt="화산 증거를 보고 난 지금, 내 선에 대한 생각은?" options={['거의 그대로 두고 조금만 다듬겠다', '몇 군데를 옮기거나 지우겠다', '새 선을 추가하겠다', '아직 잘 모르겠다']} />
        </Card>
      )
    case 'plate-what':
      return (
        <Card kicker="Step 8 · 1" title="판과 판의 경계">
          <div className="prose-lg">
            <p>지구의 겉부분은 한 덩어리가 아니라 <em>여러 조각의 판</em>으로 나뉘어 있고, 이 판들은 아주 천천히 움직입니다. 판과 판이 만나는 곳이 <mark>판의 경계</mark>입니다.</p>
            <p>판이 서로 밀고, 벌어지고, 어긋나는 곳에서 암석이 깨지고 마그마가 올라옵니다. 그래서 지진과 화산이 판의 경계를 따라 많이 나타납니다.</p>
            <p>다음 화면에서 보게 될 판 경계 선은 연구자들이 여러 관측을 종합해 만든 <em>모형</em>입니다. 우리가 그린 선과 비교하되, 점수를 매기는 것이 아닙니다. 경계 밖에서도 지진은 일어납니다.</p>
          </div>
          <div className="callout brass"><strong>비교할 때 볼 것</strong>① 내 선과 모형이 겹치는 곳 ② 어긋나는 곳 ③ 모형의 경계 밖에서 일어난 지진 ④ 화산이 경계 위에 있는가</div>
        </Card>
      )
    case 'plate-reflect':
      return (
        <Card kicker="Step 8 · 3" title="내 선과 모형 비교하기">
          <div className="compare-grid">
            <MiniMap ctx={ctx} kind="first" caption="최초 추론 (흰 실선) · 지진만" />
            <MiniMap ctx={ctx} kind="revised" withVolcano withPlates caption="수정 추론 (황동 점선) · 화산·판 경계 모형 함께" />
          </div>
          <Choices ctx={ctx} prompt="비교해 보니 (모두 고르기)" options={['내 선과 모형이 거의 겹치는 구간이 있다', '내 선이 모형과 많이 어긋난 구간이 있다', '모형의 경계 밖에서 일어난 지진을 찾았다', '화산은 대부분 경계 위에 있다', '바다 한가운데 경계(대서양)를 나는 긋지 않았다', '처음보다 수정 추론이 모형에 더 가깝다']} />
          <Note ctx={ctx} prompt="가장 크게 어긋난 곳은 어디이고, 그 이유는 무엇이라고 생각하나요?" />
        </Card>
      )
    case 'explain-write':
      return <ExplainWrite ctx={ctx} />
    case 'explain-limits':
      return <ExplainLimits ctx={ctx} />
    case 'wrap-compare':
      return (
        <Card kicker="Step 10 · 1" title="처음 생각과 수정한 생각">
          <div className="compare-grid">
            <MiniMap ctx={ctx} kind="first" caption="처음 생각 · 최초 추론" />
            <MiniMap ctx={ctx} kind="revised" withVolcano withPlates caption="수정한 생각 · 수정 추론" />
          </div>
          <div className="prose-lg" style={{ marginTop: 16 }}>
            <p>왼쪽은 지진만 보고 그은 선, 오른쪽은 화산을 본 뒤 고친 선입니다. 무엇이 달라졌나요? 달라지지 않았다면 왜일까요?</p>
            <p>오늘 우리가 한 일은 "판의 경계를 외운 것"이 아니라, <em>흩어진 점에서 규칙을 찾고, 새 증거로 생각을 고친 것</em>입니다. 그것이 과학자가 일하는 방법입니다.</p>
          </div>
          <Note ctx={ctx} prompt="처음 생각에서 수정한 생각으로 바뀐 가장 큰 변화는 무엇인가요?" />
        </Card>
      )
    case 'wrap-card':
      return (
        <Card kicker="Step 10 · 2" title="탐구 카드">
          <div className="prose-lg">
            <p>오늘의 활동이 탐구 카드 한 장에 정리됩니다. 탐구 질문, 처음 생각, 관찰 증거, 수정한 생각, 나의 설명, 자료의 한계, 출처.</p>
          </div>
          <EvidenceStrip ctx={ctx} />
          <div className="row" style={{ marginTop: 16 }}>
            {ctx.reportHref ? <Link to={ctx.reportHref} className="btn btn-primary btn-lg">탐구 카드 열기</Link> : null}
            {ctx.role !== 'teacher' ? <Button variant="secondary" icon="download" onClick={() => exportRecordJson(ctx.record, { nickname: ctx.nickname })}>JSON 내려받기</Button> : null}
          </div>
          <table className="data" style={{ marginTop: 20 }}>
            <tbody>
              <tr><th>최초 추론</th><td>{ctx.record.firstGuess ? `선 ${ctx.record.firstGuess.guess.lines.length}개 · ${formatKst(ctx.record.firstGuess.submittedAt)}` : '제출하지 않음'}</td></tr>
              <tr><th>수정 추론</th><td>{ctx.record.revisedGuess ? `선 ${ctx.record.revisedGuess.guess.lines.length}개 · ${formatKst(ctx.record.revisedGuess.submittedAt)}` : '제출하지 않음'}</td></tr>
              <tr><th>관찰 증거</th><td>{ctx.record.evidence.length}개</td></tr>
              <tr><th>설명 · 한계</th><td>{ctx.record.explanation?.text.trim() ? '작성함' : '아직 작성하지 않음'} · {ctx.record.explanation?.limitations.trim() ? '작성함' : '아직 작성하지 않음'}</td></tr>
            </tbody>
          </table>
          <div className="callout brass" style={{ marginTop: 16 }}><strong>다음 시간 예고</strong>판은 왜 움직일까? 대륙은 정말 옮겨 다녔을까? 오늘 찾은 경계선이 그 이야기의 출발점입니다.</div>
        </Card>
      )
    default:
      return <Card title="준비 중인 화면"><p className="muted">이 화면의 내용이 아직 없습니다.</p></Card>
  }
}

function ExplainWrite({ ctx }: { ctx: ScreenCtx }) {
  const saved = ctx.record.explanation?.text ?? ''
  const text = ctx.explanationDraft?.text ?? saved
  return (
    <Card kicker="Step 9 · 1" title="나의 설명">
      <div className="prose-lg"><p>관찰한 증거를 근거로 <em>지진·화산의 분포와 판의 경계가 어떻게 관련되는지</em> 설명해 보세요. 아래 증거를 "증거 1에서 …"처럼 인용하면 좋은 설명이 됩니다. 이 글은 자동으로 채워지지 않습니다.</p></div>
      <div style={{ marginTop: 14 }}><EvidenceStrip ctx={ctx} /></div>
      {ctx.role === 'teacher' ? <div className="teacher-hint"><strong>진행 팁</strong> "증거 번호를 적어라", "띠·경계·화산 세 낱말을 쓰라"처럼 조건을 걸면 글이 구체적이 됩니다. 입력 잠금으로 마감하세요.</div> : (
        <div className="response">
          <label className="label" htmlFor="exp-text">나의 설명 <span className="muted num">({text.length}/1500)</span></label>
          <textarea id="exp-text" className="textarea" disabled={ctx.inputLocked} style={{ minHeight: 160 }} maxLength={1500} value={text} onChange={(e) => ctx.onExplanationDraft('text', e.target.value)} placeholder="예: 증거 1에서 태평양 가장자리를 따라 지진이 띠를 이루고, 증거 2에서 화산도 같은 띠 위에 … 따라서 …" />
          <div className="row between"><span className="tiny muted">{saved === text ? (saved ? '저장됨' : '') : '저장되지 않은 변경'}</span><Button variant="primary" icon="check" onClick={() => ctx.onExplanation(text, ctx.record.explanation?.limitations ?? '')} disabledReason={ctx.inputLocked ? '입력이 잠겨 있습니다' : saved === text ? '바뀐 내용이 없습니다' : undefined}>설명 저장</Button></div>
        </div>
      )}
    </Card>
  )
}

function ExplainLimits({ ctx }: { ctx: ScreenCtx }) {
  const saved = ctx.record.explanation?.limitations ?? ''
  const text = ctx.explanationDraft?.limitations ?? saved
  const chosen = ctx.response?.choices ?? []
  const options = ['규모 5.0보다 작은 지진은 자료에 없다', '화산 목록은 지금 분화 중인 목록이 아니다', '지진(10년)과 화산(1만 년)의 기간이 다르다', '최근 지진이 없는 곳이 안전하다는 뜻은 아니다', '판 경계는 연구 모형이라 실제와 다를 수 있다', '내 선은 대충 그어져서 정확하지 않다']
  const toggle = (o: string) => ctx.setResponse({ choices: chosen.includes(o) ? chosen.filter((c) => c !== o) : [...chosen, o] })
  return (
    <Card kicker="Step 9 · 2" title="자료의 한계">
      <div className="prose-lg"><p>좋은 과학 설명에는 <em>이 설명이 어디까지 믿을 만한가</em>가 함께 적혀 있습니다. 오늘 쓴 자료의 한계를 골라 보고, 내 말로 적어 보세요.</p></div>
      {ctx.role === 'teacher' ? <div className="teacher-hint"><strong>학생 화면</strong> 한계 보기 6개를 고르고 자기 말로 씁니다.</div> : (
        <>
          <div className="response">
            <div className="label">해당하는 한계를 고르세요</div>
            <div className="choice-grid">{options.map((o) => <label key={o} className={'choice' + (chosen.includes(o) ? ' is-on' : '')}><input type="checkbox" disabled={ctx.inputLocked} checked={chosen.includes(o)} onChange={() => toggle(o)} /><span>{o}</span></label>)}</div>
          </div>
          <div className="response">
            <label className="label" htmlFor="exp-lim">내 말로 쓰기</label>
            <textarea id="exp-lim" className="textarea" disabled={ctx.inputLocked} style={{ minHeight: 100 }} maxLength={1500} value={text} onChange={(e) => ctx.onExplanationDraft('limitations', e.target.value)} placeholder="예: 규모 5 이상만 봤기 때문에 작은 지진이 많은 곳은 …" />
            <div className="row between"><span className="tiny muted">{saved === text ? (saved ? '저장됨' : '') : '저장되지 않은 변경'}</span><Button variant="primary" icon="check" onClick={() => ctx.onExplanation(ctx.record.explanation?.text ?? '', text)} disabledReason={ctx.inputLocked ? '입력이 잠겨 있습니다' : saved === text ? '바뀐 내용이 없습니다' : undefined}>한계 저장</Button></div>
          </div>
        </>
      )}
    </Card>
  )
}
