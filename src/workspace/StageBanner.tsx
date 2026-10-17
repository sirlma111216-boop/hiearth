import type { Stage } from '@shared/domain/types'
import { STAGE_INFO, nextStage, prevStage } from '@shared/domain/activity'
import { STAGES } from '@shared/domain/types'
import { Button } from '../ui/Button'

interface Props {
  stage: Stage
  /** 이동 가능한 최대 단계 (학생은 교사가 연 단계까지) */
  maxStage: Stage
  onStage: (s: Stage) => void
  nextDisabledReason?: string
  role: 'solo' | 'student' | 'teacher'
}

export function StageBanner({ stage, maxStage, onStage, nextDisabledReason, role }: Props) {
  const info = STAGE_INFO[stage]
  const prev = prevStage(stage)
  const next = nextStage(stage)
  const canNext = next != null && STAGE_INFO[next].index <= STAGE_INFO[maxStage].index
  return (
    <div className="panel stage-banner" role="region" aria-label="현재 활동">
      <Button variant="quiet" size="sm" icon="arrowLeft" onClick={() => prev && onStage(prev)} disabledReason={!prev ? '첫 활동입니다' : undefined} aria-label="이전 활동" />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="stage-no">{String(info.index + 1).padStart(2, '0')} / {STAGES.length} · {info.short}</div>
        <h2>{info.title}</h2>
        <p>{info.guidance}</p>
      </div>
      <Button variant={canNext ? 'primary' : 'quiet'} size="sm" iconRight="arrowRight" onClick={() => next && onStage(next)}
        disabledReason={!next ? '마지막 활동입니다' : !canNext ? (role === 'student' ? '선생님이 다음 활동을 열면 이동할 수 있습니다' : '다음 활동으로 이동할 수 없습니다') : nextDisabledReason}>
        {role === 'solo' ? '다음' : '다음'}
      </Button>
    </div>
  )
}
