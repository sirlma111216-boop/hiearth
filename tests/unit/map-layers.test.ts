import { describe, expect, it } from 'vitest'
import { ALL_LAYERS, isGuessVisible, type RenderGuess } from '../../src/map/types'
import { guessStyle, MAP_COLORS } from '../../src/map/colors'

describe('추론 레이어', () => {
  it('선택 강조한 선도 원래 레이어를 끄면 숨긴다', () => {
    const selected: RenderGuess = { id: 'selected', style: 'draft', layer: 'myRevised', lines: [] }
    const highlighted: RenderGuess = { id: 'highlighted', style: 'highlightA', layer: 'myFirst', lines: [] }
    expect(isGuessVisible(selected, { ...ALL_LAYERS, myRevised: false })).toBe(false)
    expect(isGuessVisible(highlighted, { ...ALL_LAYERS, myFirst: false })).toBe(false)
    expect(isGuessVisible(selected, ALL_LAYERS)).toBe(true)
  })
  it('교사 비교 강조에서도 최초·수정 선의 색과 선 종류를 유지한다', () => {
    const first = guessStyle({ id: 'first', style: 'highlightB', layer: 'myFirst', lines: [] })
    const revised = guessStyle({ id: 'revised', style: 'highlightA', layer: 'myRevised', lines: [] })
    expect(first.color).toBe(MAP_COLORS.first)
    expect(first.dash).toHaveLength(0)
    expect(revised.color).toBe(MAP_COLORS.revised)
    expect(revised.dash.length).toBeGreaterThan(0)
  })
})
