// 혼자 탐사 — 사용자가 증거 공개와 다음 활동을 직접 진행한다.
import { useCallback } from 'react'
import type { GuessKind, Stage } from '@shared/domain/types'
import { STAGE_INFO } from '@shared/domain/activity'
import { useLesson, LoadingScreen } from '../data/useLesson'
import { makeRevision } from '../inquiry/engine'
import { useLocalInquiry } from '../inquiry/useLocalInquiry'
import { TopBar } from '../ui/TopBar'
import { useToast } from '../ui/Toast'
import { Workspace } from '../workspace/Workspace'
import { audio } from '../audio/AudioManager'
import type { LessonData } from '../data/lesson'

export default function Explore() {
  const { data, error, progress, retry } = useLesson()
  if (!data) return <LoadingScreen progress={progress} error={error} onRetry={retry} />
  return <ExploreInner data={data} />
}

function ExploreInner({ data }: { data: LessonData }) {
  const [state, dispatch] = useLocalInquiry(data.datasetVersion)
  const toast = useToast()
  const onSubmit = useCallback((kind: GuessKind) => {
    const rev = makeRevision(kind, state.draft, data.datasetVersion)
    dispatch({ type: 'submit/start', kind })
    // 혼자 탐사: 로컬 저장이 곧 확정
    dispatch({ type: 'submit/saved', revision: rev })
    void audio.play('submit-confirm')
    toast.push(kind === 'first' ? '최초 추론을 이 기기에 저장했습니다.' : '수정 추론을 저장했습니다.', 'success')
  }, [state.draft, data.datasetVersion, dispatch, toast])
  const onStage = useCallback((s: Stage) => {
    dispatch({ type: 'setStage', stage: s })
    dispatch({ type: 'submit/reset' })
  }, [dispatch])
  const stageInfo = STAGE_INFO[state.record.stage]
  return (
    <>
      <TopBar center={<span className="status-pill"><strong>혼자 탐사</strong> · {stageInfo.short}</span>} />
      <Workspace data={data} state={state} dispatch={dispatch} role="solo" onSubmit={onSubmit} onStage={onStage}
        onExplanation={(t, l) => { dispatch({ type: 'explanation/set', text: t, limitations: l }); toast.push('설명을 저장했습니다.', 'success') }}
        reportHref="/report/local" extraTop={null} />
    </>
  )
}
