import { useState } from 'react'
import type { DrawMode, Stage, GuessKind } from '@shared/domain/types'
import { MAX_LINES } from '@shared/domain/types'
import { STAGE_INFO } from '@shared/domain/activity'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import type { InquiryState } from '../inquiry/engine'
import { draftMatchesRevision } from '../inquiry/engine'
interface Props {
  state: InquiryState; stage: Stage; mode: 'move' | 'draw'
  onMode: (m: 'move' | 'draw') => void; onDrawMode: (m: DrawMode) => void
  onUndo: () => void; onRedo: () => void; onDeleteSelected: () => void; onClear: () => void
  onSelectLine: (id: string | null) => void; onFinishPending: () => void; onCopyFirst: () => void
  onSubmit: (kind: GuessKind) => void; onExplanation: (text: string, limitations: string) => void
  inputLocked?: boolean; lockedReason?: string; role: 'solo' | 'student' | 'teacher'
}
export function InferencePanel(p: Props) {
  const kind = STAGE_INFO[p.stage].drawing
  const d = p.state.draft
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const firstSaved = kind === 'first' && !!p.state.record.firstGuess
  const savedRevision = kind === 'revised' ? p.state.record.revisedGuess : p.state.record.firstGuess
  const unchanged = draftMatchesRevision(d, savedRevision)
  const saved = firstSaved || unchanged
  const pending = p.state.submit.status === 'pending' || p.state.submit.status === 'queued'
  if (p.role === 'teacher' || kind === 'none') return null
  if (firstSaved) return <div className="drawing-controls submitted" role="status"><strong>{p.role === 'solo' ? '첫 생각을 이 기기에 남겼어요.' : '첫 생각을 선생님께 보냈어요.'}</strong><span>처음 선은 그대로 보관됩니다. 화산 자료를 본 뒤 새 선을 남길 수 있어요.</span></div>
  if (p.inputLocked) return <p className="drawing-controls" role="status">{p.lockedReason ?? '선생님이 입력을 잠갔습니다. 그리던 선은 남아 있습니다.'}</p>
  return <div className="drawing-controls">
    <div className="row draw-toolbar" role="toolbar" aria-label="선 그리기 도구">
      <Button active={p.mode === 'move'} aria-pressed={p.mode === 'move'} onClick={() => p.onMode('move')}>지도 움직이기</Button>
      <Button active={p.mode === 'draw'} aria-pressed={p.mode === 'draw'} onClick={() => p.onMode('draw')} disabled={pending}>선 그리기</Button>
      <Button variant="quiet" onClick={p.onUndo} disabled={pending || (!d.undo.length && !d.pending.length)}>되돌리기</Button>
      <details className="simple-details line-edit"><summary>선 편집</summary><div className="stack">
        <div className="row"><Button size="sm" active={d.mode === 'freehand'} onClick={() => p.onDrawMode('freehand')} disabled={pending}>끌어서 그리기</Button><Button size="sm" active={d.mode === 'polyline'} onClick={() => p.onDrawMode('polyline')} disabled={pending}>점 찍어 그리기</Button></div>
        <div className="row"><Button size="sm" onClick={p.onRedo} disabled={pending || !d.redo.length}>다시 실행</Button><Button size="sm" onClick={p.onDeleteSelected} disabled={pending || !d.selectedLineId}>선택한 선 삭제</Button><Button size="sm" onClick={() => setConfirmClear(true)} disabled={pending || !d.lines.length}>전체 지우기</Button></div>
        <label>편집할 선<select className="select" value={d.selectedLineId ?? ''} onChange={e => p.onSelectLine(e.target.value || null)}><option value="">선을 선택하세요</option>{d.lines.map((l,i) => <option value={l.id} key={l.id}>선 {i+1}</option>)}</select></label>
        {kind === 'revised' && p.state.record.firstGuess ? <Button size="sm" onClick={p.onCopyFirst} disabled={pending}>처음 선을 다시 가져오기</Button> : null}
      </div></details>
    </div>
    <p className="hint">{p.mode === 'draw' ? d.mode === 'freehand' ? '손가락이나 마우스로 끌어서 선을 그리세요. 위치를 바꾸려면 지도 움직이기를 누르세요.' : '점을 차례로 누른 뒤 선 마치기를 누르세요.' : '지도를 움직여 위치를 정하세요. 선을 그리려면 선 그리기를 누르세요.'}</p>
    {d.pending.length ? <Button size="sm" onClick={p.onFinishPending} disabled={d.pending.length < 2 || pending}>선 마치기</Button> : null}
    <div className="row between submit-row">
      <div><span className="hint">{d.lines.length ? `그린 선 ${d.lines.length}개` : '아직 그린 선이 없습니다.'}{d.lines.length >= MAX_LINES ? ' · 선은 12개까지 그릴 수 있어요.' : ''}</span><p className="hint">{kind === 'first' ? '처음 선은 제출 후 그대로 남고, 나중 선은 따로 저장됩니다.' : '바꿀 이유가 없으면 현재 선을 그대로 제출하세요.'}</p><span role="status">{pending || p.state.submit.status === 'error' ? p.state.submit.message : saved ? p.role === 'solo' ? '이 기기에 저장했습니다.' : '선생님께 보냈어요.' : ''}</span></div>
      {!saved ? <Button variant="primary" loading={p.state.submit.status === 'pending'} disabledReason={pending ? '전송이 끝날 때까지 기다려 주세요.' : !d.lines.length ? '선을 하나 이상 그려 주세요.' : d.pending.length ? '그리는 선을 먼저 마쳐 주세요.' : undefined} onClick={() => kind === 'first' ? setConfirmSubmit(true) : p.onSubmit('revised')}>{kind === 'first' ? '첫 생각 제출하기' : '지금 선으로 제출하기'}</Button> : <span className="status-pill">제출 완료</span>}
    </div>
    <Dialog open={confirmSubmit} title="첫 생각을 남길까요?" onClose={() => setConfirmSubmit(false)} actions={<><Button onClick={() => setConfirmSubmit(false)}>계속 그리기</Button><Button variant="primary" onClick={() => { setConfirmSubmit(false); p.onSubmit('first') }}>이 선으로 제출</Button></>}><p>처음 선은 제출 후 그대로 보관됩니다. 화산 자료를 본 뒤 수정한 선을 따로 남길 수 있어요.</p></Dialog>
    <Dialog open={confirmClear} title="그린 선을 모두 지울까요?" onClose={() => setConfirmClear(false)} actions={<><Button onClick={() => setConfirmClear(false)}>취소</Button><Button variant="destructive" onClick={() => { p.onClear(); setConfirmClear(false) }}>모두 지우기</Button></>}><p>제출한 기록은 바뀌지 않습니다. 되돌리기로 복구할 수 있습니다.</p></Dialog>
  </div>
}
