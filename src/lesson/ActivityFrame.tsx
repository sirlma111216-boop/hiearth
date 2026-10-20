import type { ReactNode } from 'react'
import type { LayerId } from '@shared/domain/types'
import { isoDateUtc } from '@shared/geo/time'
import { Workspace, type WorkspaceProps } from '../workspace/Workspace'
export interface ActivityTask {
  question: string
  hint: string
  panels?: WorkspaceProps['panels']
  initialLayers?: Partial<Record<LayerId, boolean>>
  teacherTip?: string
}
interface Props {
  task: ActivityTask
  workspace: Omit<WorkspaceProps, 'embedded' | 'panels' | 'reveal' | 'initialLayers'>
  role: 'solo' | 'student' | 'teacher'
  notice?: ReactNode
}
export function ActivityFrame({ task, workspace, role, notice }: Props) {
  const eq = workspace.data.manifest.datasets.earthquakesLesson
  const stage = workspace.stageOverride
  return <div>
    <p className="activity-hint">{task.hint}</p>
    <p className="dataset-caption">● 지진 · {isoDateUtc(Date.parse(eq.coverageStart!))}–{isoDateUtc(Date.parse(eq.coverageEnd!) - 1)} · 규모 5 이상{stage === 'revise' || stage === 'boundaryCompare' ? '　△ 화산 · 현재 분화 중인 목록이 아닙니다' : ''}{stage === 'boundaryCompare' ? '　━ 판 경계 연구 모형' : ''}</p>
    {notice}
    <Workspace {...workspace} embedded panels={{ banner: false, ...(task.panels ?? {}) }} reveal={null} initialLayers={task.initialLayers} />
    {role === 'teacher' && task.teacherTip ? <p className="teacher-hint">{task.teacherTip}</p> : null}
    <details className="simple-details lesson-concepts"><summary>지도를 읽는 방법과 자료 출처</summary><p>점은 지진이 발생한 진앙, 점 크기는 규모를 나타냅니다. 피해 범위나 위험도가 아닙니다. 지진 기록은 USGS, 화산 목록은 Smithsonian GVP, 판 경계는 USGS 연구 모형입니다. 지진이 적게 표시된 곳이 안전하다는 뜻은 아닙니다.</p><p>판은 지구 겉부분을 이루는 조각이며, 판과 판이 만나는 곳을 판의 경계라고 합니다. 화산 목록에는 바다 밑 화산이 적게 포함될 수 있습니다.</p><a href="/sources" target="_blank" rel="noreferrer">자료 출처와 범위 자세히 보기</a></details>
  </div>
}
