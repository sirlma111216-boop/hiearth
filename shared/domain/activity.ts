import { STAGES, type Stage, type InquiryRecord } from './types'

export interface StageInfo {
  id: Stage
  index: number
  short: string
  title: string
  question: string
  guidance: string
  /** 이 단계에서 그리기 입력이 열리는가 */
  drawing: 'none' | 'first' | 'revised'
  /** 이 단계에서 화산 레이어가 보이는가 */
  volcanoes: boolean
  /** 이 단계에서 판 경계 레이어가 보이는가 */
  boundaries: boolean
}

const defs: Omit<StageInfo, 'index'>[] = [
  {
    id: 'observe',
    short: '관찰',
    title: '지진은 어디에 집중되어 있을까?',
    question: '지진은 어디에 집중되어 있는가? 어떤 띠를 이루는가?',
    guidance: '지도를 돌리고 확대하며 지진이 모여 있는 곳을 찾아보세요. 시간 재생으로 기간이 길어질수록 어떤 띠가 드러나는지 살펴보세요.',
    drawing: 'none',
    volcanoes: false,
    boundaries: false,
  },
  {
    id: 'firstGuess',
    short: '최초 추론',
    title: '판의 경계가 있을 것 같은 곳에 선을 그려 보세요',
    question: '지진 분포만 보고, 판의 경계가 있을 것 같은 곳은 어디인가?',
    guidance: '그리기 모드에서 지진이 띠를 이루는 곳을 따라 선을 그립니다. 확신이 없어도 괜찮습니다. 제출하면 최초 추론으로 기록됩니다.',
    drawing: 'first',
    volcanoes: false,
    boundaries: false,
  },
  {
    id: 'firstReveal',
    short: '추론 공개',
    title: '우리 반의 추론이 모였습니다',
    question: '우리는 어디에서 의견이 겹치고, 어디에서 갈리는가?',
    guidance: '겹치는 선은 많은 사람이 같은 지역을 골랐다는 뜻입니다. 겹침은 정답 확률이나 위험도가 아니라 "의견 겹침"입니다.',
    drawing: 'none',
    volcanoes: false,
    boundaries: false,
  },
  {
    id: 'volcanoReveal',
    short: '화산 증거',
    title: '새로운 증거: 화산의 위치',
    question: '화산의 분포는 지진의 분포와 어떤 공통점이 있는가?',
    guidance: '화산 위치(삼각형)가 지도에 추가되었습니다. 화산과 지진이 함께 나타나는 곳과 따로 나타나는 곳을 비교해 보세요.',
    drawing: 'none',
    volcanoes: true,
    boundaries: false,
  },
  {
    id: 'revise',
    short: '수정 추론',
    title: '증거를 보고 추론을 고쳐 보세요',
    question: '화산 자료를 함께 고려하면 선을 어떻게 바꾸겠는가?',
    guidance: '최초 추론을 복사해서 고칠 수 있습니다. 최초 기록은 그대로 남고, 수정한 선은 별도로 저장됩니다.',
    drawing: 'revised',
    volcanoes: true,
    boundaries: false,
  },
  {
    id: 'boundaryCompare',
    short: '경계 비교',
    title: '연구 모형의 판 경계와 비교하기',
    question: '지진·화산의 분포는 판의 경계와 어떻게 관련되는가?',
    guidance: '판 경계 선은 연구자들이 만든 모형입니다. 내 선과 겹치는 곳, 어긋나는 곳, 경계 밖에서 일어난 지진을 찾아보세요. 점수를 매기는 활동이 아닙니다.',
    drawing: 'none',
    volcanoes: true,
    boundaries: true,
  },
  {
    id: 'explain',
    short: '설명 작성',
    title: '근거가 있는 설명 쓰기',
    question: '관찰한 증거를 바탕으로, 지진·화산 분포와 판 경계의 관련을 어떻게 설명하겠는가?',
    guidance: '담아 둔 관찰 증거를 인용하며 설명을 씁니다. 자료의 한계(기간·규모 조건·누락)를 함께 적어 보세요.',
    drawing: 'none',
    volcanoes: true,
    boundaries: true,
  },
  {
    id: 'wrapUp',
    short: '결과 정리',
    title: '탐구 카드가 준비되었습니다',
    question: '처음 생각과 수정한 생각은 어떻게 달라졌는가?',
    guidance: '탐구 카드에서 처음 선과 수정한 선을 나란히 비교하고, 저장하거나 인쇄할 수 있습니다.',
    drawing: 'none',
    volcanoes: true,
    boundaries: true,
  },
]

export const STAGE_INFO: Record<Stage, StageInfo> = Object.fromEntries(
  defs.map((d, index) => [d.id, { ...d, index }]),
) as Record<Stage, StageInfo>

export const stageIndex = (s: Stage) => STAGE_INFO[s].index
export const nextStage = (s: Stage): Stage | null => STAGES[stageIndex(s) + 1] ?? null
export const prevStage = (s: Stage): Stage | null => STAGES[stageIndex(s) - 1] ?? null
export const isStage = (v: unknown): v is Stage => typeof v === 'string' && (STAGES as readonly string[]).includes(v)

/** 단계가 적어도 target 이상 진행되었는가 */
export const reached = (current: Stage, target: Stage) => stageIndex(current) >= stageIndex(target)

export function emptyRecord(datasetVersion: string): InquiryRecord {
  return {
    version: 1,
    stage: 'observe',
    firstGuess: null,
    revisedGuess: null,
    evidence: [],
    explanation: null,
    history: [{ stage: 'observe', at: Date.now() }],
    datasetVersion,
  }
}

/**
 * 단계 전이. 뒤로 돌아가도 이미 제출된 최초 추론은 유지된다.
 * 기록(history)에는 모든 이동을 남긴다.
 */
export function moveStage(record: InquiryRecord, to: Stage, at = Date.now()): InquiryRecord {
  if (record.stage === to) return record
  return { ...record, stage: to, history: [...record.history, { stage: to, at }] }
}

/** 교사 체크리스트용 — 확인 가능한 값만 계산한다 (과학적 정확도는 판정하지 않는다) */
export function checklist(record: InquiryRecord) {
  return {
    hasObservationEvidence: record.evidence.length > 0,
    consideredVolcanoes: record.revisedGuess != null || record.evidence.some((e) => e.layers.includes('volcanoes')),
    revisedExplanation: record.revisedGuess != null,
    wroteLimitations: !!record.explanation?.limitations.trim(),
    wroteExplanation: !!record.explanation?.text.trim(),
  }
}
