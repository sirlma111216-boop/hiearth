import type { RegionPreset } from './types'

/** 탐구 시작 위치 프리셋. 시작 위치일 뿐이며 사용자는 어디로든 이동할 수 있다. */
export const REGION_PRESETS: RegionPreset[] = [
  { id: 'world', label: '전 지구', view: { center: [20, 10], zoom: 1 } },
  { id: 'pacific', label: '태평양 중심', view: { center: [-170, 10], zoom: 1.15 } },
  { id: 'japan', label: '일본 주변', view: { center: [138, 36], zoom: 5.5 } },
  { id: 'south-america', label: '남아메리카 서안', view: { center: [-72, -22], zoom: 3.2 } },
  { id: 'mid-atlantic', label: '대서양 중앙부', view: { center: [-28, 15], zoom: 2.2 } },
]

export const presetById = (id: string) => REGION_PRESETS.find((p) => p.id === id) ?? REGION_PRESETS[0]

export const DATASETS = [
  { id: 'usgs-lesson-2015-2025-m5', label: '수업용 장기 자료 · 2015~2024년 · 규모 5.0 이상' },
] as const
export type DatasetId = (typeof DATASETS)[number]['id']
export const DEFAULT_DATASET: DatasetId = 'usgs-lesson-2015-2025-m5'
