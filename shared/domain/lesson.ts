// 수업 흐름 — 단계(step)와 화면(sub)의 단일 출처. 번호를 다른 곳에 적지 않는다.
// 각 화면은 '활동 상태(stage)'에 연결되어 교실에서는 교사가 연 화면까지만 학생이 갈 수 있다.
import type { Stage } from './types'
import { stageIndex } from './activity'

export type ScreenKind = 'narrative' | 'content' | 'activity' | 'reflect' | 'write' | 'summary'

export interface LessonScreen {
  /** 화면 고유 id — 내용·응답 저장에 쓴다 (번호가 바뀌어도 유지) */
  id: string
  step: number
  sub: number
  kind: ScreenKind
  title: string
  /** 이 화면이 열리려면 교실의 활동 상태가 이 단계 이상이어야 한다 */
  stage: Stage
  /** 설명 위주라 시간이 없을 때 건너뛸 수 있는 화면 */
  skippable?: boolean
}

export interface LessonStep {
  n: number
  short: string
  long: string
  period: 1 | 2
  first?: boolean
}

export const LESSON_STEPS: LessonStep[] = [
  { n: 1, short: '시작', long: '흔들리는 지구', period: 1 },
  { n: 2, short: '지진 자료', long: '점 하나가 지진 하나', period: 1 },
  { n: 3, short: '관찰', long: '지진은 어디에 모여 있을까', period: 1 },
  { n: 4, short: '추론', long: '경계를 그려 보자', period: 1 },
  { n: 5, short: '돌아보기', long: '우리가 그린 선', period: 1 },
  { n: 6, short: '화산', long: '새로운 증거, 화산', period: 2, first: true },
  { n: 7, short: '수정', long: '증거로 생각 고치기', period: 2 },
  { n: 8, short: '판의 경계', long: '연구 모형과 비교', period: 2 },
  { n: 9, short: '설명', long: '근거 있는 설명 쓰기', period: 2 },
  { n: 10, short: '결론', long: '무엇이 달라졌나', period: 2 },
]

const S = (id: string, step: number, sub: number, kind: ScreenKind, title: string, stage: Stage, skippable = false): LessonScreen => ({ id, step, sub, kind, title, stage, skippable })

export const LESSON_SCREENS: LessonScreen[] = [
  S('intro', 1, 1, 'narrative', '흔들리는 지구', 'observe'),
  S('intro-questions', 1, 2, 'content', '오늘의 탐구 질문', 'observe'),

  S('quake-what', 2, 1, 'content', '지진은 무엇일까', 'observe', true),
  S('quake-dot', 2, 2, 'content', '점 하나는 무엇을 뜻할까', 'observe', true),
  S('quake-data', 2, 3, 'content', '우리가 쓰는 자료', 'observe', true),

  S('observe-world', 3, 1, 'activity', '전 지구를 한눈에', 'observe'),
  S('observe-time', 3, 2, 'activity', '시간을 돌려 보기', 'observe'),
  S('observe-close', 3, 3, 'activity', '가까이 들여다보기', 'observe'),

  S('guess-howto', 4, 1, 'content', '선을 긋는 방법', 'firstGuess', true),
  S('guess-draw', 4, 2, 'activity', '최초 추론 그리기', 'firstGuess'),

  S('reveal-lines', 5, 1, 'activity', '우리가 그린 선', 'firstReveal'),
  S('reveal-reflect', 5, 2, 'reflect', '내 선 돌아보기', 'firstReveal'),

  S('volcano-what', 6, 1, 'content', '화산은 어디에 있을까', 'volcanoReveal', true),
  S('volcano-open', 6, 2, 'activity', '화산 증거 열기', 'volcanoReveal'),
  S('volcano-compare', 6, 3, 'activity', '지진과 화산 겹쳐 보기', 'volcanoReveal'),

  S('revise-why', 7, 1, 'content', '생각을 고치는 것은 실력이다', 'revise', true),
  S('revise-draw', 7, 2, 'activity', '수정 추론 그리기', 'revise'),

  S('plate-what', 8, 1, 'content', '판과 판의 경계', 'boundaryCompare', true),
  S('plate-open', 8, 2, 'activity', '판 경계 모형 열기', 'boundaryCompare'),
  S('plate-reflect', 8, 3, 'reflect', '내 선과 모형 비교하기', 'boundaryCompare'),

  S('explain-write', 9, 1, 'write', '나의 설명', 'explain'),
  S('explain-limits', 9, 2, 'write', '자료의 한계', 'explain'),

  S('wrap-compare', 10, 1, 'summary', '처음 생각과 수정한 생각', 'wrapUp'),
  S('wrap-card', 10, 2, 'summary', '탐구 카드', 'wrapUp'),
]

export const LAST_STEP = LESSON_STEPS[LESSON_STEPS.length - 1].n
export const SUBS: Record<number, number> = {}
for (const sc of LESSON_SCREENS) SUBS[sc.step] = Math.max(SUBS[sc.step] ?? 0, sc.sub)

export interface ScreenRef { step: number; sub: number }

export const screenAt = (step: number, sub: number): LessonScreen | undefined => LESSON_SCREENS.find((s) => s.step === step && s.sub === sub)
export const screenById = (id: string): LessonScreen | undefined => LESSON_SCREENS.find((s) => s.id === id)
export const screenIndex = (ref: ScreenRef): number => LESSON_SCREENS.findIndex((s) => s.step === ref.step && s.sub === ref.sub)
export const isValidScreen = (v: unknown): v is ScreenRef => !!v && typeof v === 'object' && typeof (v as ScreenRef).step === 'number' && typeof (v as ScreenRef).sub === 'number' && !!screenAt((v as ScreenRef).step, (v as ScreenRef).sub)

export function clampScreen(ref: ScreenRef): ScreenRef {
  const step = Math.max(1, Math.min(LAST_STEP, Math.round(ref.step) || 1))
  const sub = Math.max(1, Math.min(SUBS[step] ?? 1, Math.round(ref.sub) || 1))
  return { step, sub }
}

export function nextScreen(ref: ScreenRef): ScreenRef | null {
  const i = screenIndex(ref)
  if (i < 0 || i >= LESSON_SCREENS.length - 1) return null
  const s = LESSON_SCREENS[i + 1]
  return { step: s.step, sub: s.sub }
}

export function prevScreen(ref: ScreenRef): ScreenRef | null {
  const i = screenIndex(ref)
  if (i <= 0) return null
  const s = LESSON_SCREENS[i - 1]
  return { step: s.step, sub: s.sub }
}

/** 다음 단계의 첫 화면 (건너뛰기) */
export function nextStepStart(ref: ScreenRef): ScreenRef | null {
  if (ref.step >= LAST_STEP) return null
  return { step: ref.step + 1, sub: 1 }
}

export const screenStage = (ref: ScreenRef): Stage => screenAt(ref.step, ref.sub)?.stage ?? 'observe'

/** a가 b보다 앞이거나 같은 화면인가 */
export const screenLE = (a: ScreenRef, b: ScreenRef) => screenIndex(a) <= screenIndex(b)

/** 교실의 활동 상태로 허용되는 마지막 화면 */
export function maxScreenForStage(stage: Stage): ScreenRef {
  let last: ScreenRef = { step: 1, sub: 1 }
  for (const s of LESSON_SCREENS) if (stageIndex(s.stage) <= stageIndex(stage)) last = { step: s.step, sub: s.sub }
  return last
}

export const FIRST_SCREEN: ScreenRef = { step: 1, sub: 1 }
export const screenLabel = (ref: ScreenRef) => {
  const st = LESSON_STEPS.find((s) => s.n === ref.step)
  return `${ref.step}/${LAST_STEP} · ${st?.long ?? ''} (${ref.sub}/${SUBS[ref.step] ?? 1})`
}
