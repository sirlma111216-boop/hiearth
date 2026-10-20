// 혼자 탐사 — 수업 화면을 스스로 넘기며 진행한다. 기록은 이 기기에 남는다.
import { useCallback, useEffect, useState } from 'react'
import type { GuessKind } from '@shared/domain/types'
import { emptyRecord } from '@shared/domain/activity'
import { FIRST_SCREEN, clampScreen, screenAt, screenStage, type ScreenRef } from '@shared/domain/lesson'
import { useLesson, LoadingScreen } from '../data/useLesson'
import type { LessonData } from '../data/lesson'
import { makeRevision } from '../inquiry/engine'
import { useLocalInquiry } from '../inquiry/useLocalInquiry'
import { loadLocalScreen, saveLocalScreen, clearLocalRecord } from '../inquiry/localStore'
import { LessonShell } from '../lesson/LessonShell'
import { TopBar } from '../ui/TopBar'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { useToast } from '../ui/Toast'
import { audio } from '../audio/AudioManager'

export default function Explore() {
  const { data, error, progress, retry } = useLesson()
  if (!data) return <LoadingScreen progress={progress} error={error} onRetry={retry} />
  return <ExploreInner data={data} />
}

function ExploreInner({ data }: { data: LessonData }) {
  const [state, dispatch] = useLocalInquiry(data.datasetVersion)
  const toast = useToast()
  const [screen, setScreen] = useState<ScreenRef>(() => clampScreen(loadLocalScreen() ?? FIRST_SCREEN))
  const hasProgress = !!state.record.firstGuess || state.record.evidence.length > 0 || screen.step > 1 || screen.sub > 1
  const [askResume, setAskResume] = useState(hasProgress)

  // 화면이 정하는 활동 상태를 기록에도 반영한다 (기록 유지, 되돌아가도 제출은 그대로)
  useEffect(() => {
    const st = screenStage(screen)
    if (state.record.stage !== st) dispatch({ type: 'setStage', stage: st })
  }, [screen, state.record.stage, dispatch])

  const onScreen = useCallback((ref: ScreenRef) => { setScreen(ref); saveLocalScreen(ref); dispatch({ type: 'submit/reset' }) }, [dispatch])

  const onSubmit = useCallback((kind: GuessKind) => {
    const rev = makeRevision(kind, state.draft, data.datasetVersion)
    dispatch({ type: 'submit/start', kind })
    dispatch({ type: 'submit/saved', revision: rev })
    void audio.play('submit-confirm')
    toast.push(kind === 'first' ? '최초 추론을 이 기기에 저장했습니다.' : '수정 추론을 저장했습니다.', 'success')
  }, [state.draft, data.datasetVersion, dispatch, toast])

  const restart = () => {
    clearLocalRecord()
    dispatch({ type: 'record/replace', record: emptyRecord(data.datasetVersion) })
    dispatch({ type: 'draft/clear' })
    onScreen(FIRST_SCREEN)
    setAskResume(false)
    toast.push('새로 시작합니다. 이전 기록은 지웠습니다.')
  }

  const def = screenAt(screen.step, screen.sub)
  return (
    <>
      <TopBar center={<span className="status-pill"><strong>혼자 탐사</strong> · {def?.title ?? ''}</span>} />
      <LessonShell role="solo" data={data} state={state} dispatch={dispatch} screen={screen} onScreen={onScreen}
        onSubmit={onSubmit}
        onExplanation={(t, l) => { dispatch({ type: 'explanation/set', text: t, limitations: l }); toast.push('저장했습니다.', 'success') }}
        reportHref="/report/local" nickname="혼자 탐사" />
      <Dialog open={askResume} title="이전에 하던 탐사가 있습니다" onClose={() => setAskResume(false)} actions={<>
        <Button variant="destructive" onClick={restart}>새로 시작</Button>
        <Button variant="primary" onClick={() => setAskResume(false)} iconRight="arrowRight">이어서 하기</Button>
      </>}>
        <p className="muted">이 기기에 저장된 기록이 있습니다. {state.record.firstGuess ? '최초 추론이 제출되어 있고, ' : ''}증거 {state.record.evidence.length}개가 담겨 있습니다. 이어서 하거나, 기록을 지우고 처음부터 시작할 수 있습니다.</p>
      </Dialog>
    </>
  )
}
