// 저장된 화면 참조는 유지한다. 표시 순서는 배열과 section만 사용한다.
import type { Stage } from './types'

export interface ScreenRef { step: number; sub: number }
export interface LessonScreen extends ScreenRef {
  id: string
  kind: 'activity' | 'write' | 'summary'
  title: string
  stage: Stage
  section: number
  nextLabel: string
}
export const LESSON_STEPS = [
  { n: 1, short: '살펴보기' }, { n: 2, short: '그려보기' },
  { n: 3, short: '증거로 다시 보기' }, { n: 4, short: '정리하기' },
]
export const LESSON_SCREENS: LessonScreen[] = [
  { id: 'observe-world', step: 3, sub: 1, kind: 'activity', title: '지진은 어디에 모여 있을까요?', stage: 'observe', section: 1, nextLabel: '선 그리기 시작' },
  { id: 'guess-draw', step: 4, sub: 2, kind: 'activity', title: '판의 경계가 있을 것 같은 곳에 선을 그려 보세요', stage: 'firstGuess', section: 2, nextLabel: '화산 자료 보기' },
  { id: 'revise-draw', step: 6, sub: 5, kind: 'activity', title: '화산 자료를 보니, 내 선을 바꾸고 싶나요?', stage: 'revise', section: 3, nextLabel: '판 경계와 비교하기' },
  { id: 'plate-open', step: 7, sub: 2, kind: 'activity', title: '연구자들의 판 경계와 내 선을 비교해 보세요', stage: 'boundaryCompare', section: 3, nextLabel: '내 설명 쓰기' },
  { id: 'explain-write', step: 8, sub: 1, kind: 'write', title: '관찰한 자료로 내 생각을 설명해 보세요', stage: 'explain', section: 4, nextLabel: '결과 보기' },
  { id: 'wrap-card', step: 8, sub: 4, kind: 'summary', title: '오늘의 탐구 결과', stage: 'wrapUp', section: 4, nextLabel: '' },
]
export const FIRST_SCREEN: ScreenRef = { step: 3, sub: 1 }
export const screenAt = (step: number, sub: number) => LESSON_SCREENS.find(s => s.step === step && s.sub === sub)
export const screenById = (id: string) => LESSON_SCREENS.find(s => s.id === id)
export const screenIndex = (s: ScreenRef) => LESSON_SCREENS.findIndex(x => x.step === s.step && x.sub === s.sub)
export const isValidScreen = (v: unknown): v is ScreenRef => !!v && typeof v === 'object' && !!screenAt((v as ScreenRef).step, (v as ScreenRef).sub)
export function refOf(id: string): ScreenRef {
  const s = screenById(id)
  if (!s) throw new Error('없는 화면 id: ' + id)
  return { step: s.step, sub: s.sub }
}
/** 기존 화면 위치만 옮기며 제출과 응답은 삭제하지 않는다. */
export function clampScreen(ref: ScreenRef): ScreenRef {
  if (screenAt(ref.step, ref.sub)) return { step: ref.step, sub: ref.sub }
  const id = ref.step <= 3 ? 'observe-world' : ref.step <= 5 ? 'guess-draw'
    : ref.step === 6 ? 'revise-draw' : ref.step === 7 ? 'plate-open'
      : ref.step === 8 && ref.sub < 3 ? 'explain-write' : 'wrap-card'
  return refOf(id)
}
export function nextScreen(ref: ScreenRef): ScreenRef | null {
  const s = LESSON_SCREENS[screenIndex(ref) + 1]
  return s ? { step: s.step, sub: s.sub } : null
}
export function prevScreen(ref: ScreenRef): ScreenRef | null {
  const s = LESSON_SCREENS[screenIndex(ref) - 1]
  return s ? { step: s.step, sub: s.sub } : null
}
export const screenStage = (ref: ScreenRef): Stage => screenAt(ref.step, ref.sub)?.stage ?? 'observe'
export const screenLE = (a: ScreenRef, b: ScreenRef) => isValidScreen(a) && isValidScreen(b) && screenIndex(a) <= screenIndex(b)
export const screenLabel = (ref: ScreenRef) => screenAt(ref.step, ref.sub)?.title ?? '지진 살펴보기'
