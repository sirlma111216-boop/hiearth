import { useState } from 'react'
import type { DrawMode, Stage, GuessKind } from '@shared/domain/types'
import { MAX_LINES, MAX_TEXT } from '@shared/domain/types'
import { STAGE_INFO } from '@shared/domain/activity'
import { formatKst } from '@shared/geo/time'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Dialog } from '../ui/Dialog'
import type { InquiryState } from '../inquiry/engine'

interface Props {
  state: InquiryState
  stage: Stage
  mode: 'move' | 'draw'
  onMode: (m: 'move' | 'draw') => void
  onDrawMode: (m: DrawMode) => void
  onUndo: () => void
  onRedo: () => void
  onDeleteSelected: () => void
  onClear: () => void
  onSelectLine: (id: string | null) => void
  onFinishPending: () => void
  onCopyFirst: () => void
  onSubmit: (kind: GuessKind) => void
  onExplanation: (text: string, limitations: string) => void
  inputLocked?: boolean
  lockedReason?: string
  role: 'solo' | 'student' | 'teacher'
}

export function InferencePanel(p: Props) {
  const info = STAGE_INFO[p.stage]
  const drawingKind = info.drawing
  const d = p.state.draft
  const [confirmClear, setConfirmClear] = useState(false)
  const [preview, setPreview] = useState<GuessKind | null>(null)
  const firstDone = !!p.state.record.firstGuess
  const firstSubmitted = drawingKind === 'first' && firstDone
  const submitting = p.state.submit.status === 'pending' || p.state.submit.status === 'queued'
  const canDraw = drawingKind !== 'none' && !firstSubmitted && !submitting && !p.inputLocked && p.role !== 'teacher'
  const totalPoints = d.lines.reduce((n, l) => n + l.points.length, 0)
  const submitLabel = drawingKind === 'first' ? '최초 추론 제출' : '수정 추론 제출'
  const submitStatus = p.state.submit

  return (
    <div className="ws-panel panel">
      <h2><Icon name="draw" /> 추론 도구</h2>
      {p.role === 'teacher' ? <p className="hint" style={{ marginTop: 8 }}>교사 화면에서는 선을 그리지 않습니다. 학생 추론은 공개 후 지도에 겹쳐 보입니다.</p> : null}
      {firstSubmitted && p.role !== 'teacher' ? <p className="hint" style={{ marginTop: 8 }} role="status">최초 추론 제출 완료 · 선 {p.state.record.firstGuess!.guess.lines.length}개<br />지도에는 제출한 선이 표시됩니다. 이 선은 그대로 보관하고, 화산 증거를 본 뒤 수정 추론에서 고칩니다.</p> : null}
      {submitting && !firstSubmitted && p.role !== 'teacher' ? <p className="hint" style={{ marginTop: 8 }} role="status">{p.state.submit.message ?? '전송 중입니다.'}</p> : null}

      {canDraw ? (
        <>
          <div className="row" style={{ marginTop: 12 }}>
            <Button size="sm" icon="move" active={p.mode === 'move'} onClick={() => p.onMode('move')}>이동</Button>
            <Button size="sm" icon="draw" active={p.mode === 'draw'} onClick={() => p.onMode('draw')}>그리기</Button>
          </div>
          {p.mode === 'draw' ? (
            <div className="row" style={{ marginTop: 8 }}>
              <Button size="sm" variant="quiet" icon="draw" active={d.mode === 'freehand'} onClick={() => p.onDrawMode('freehand')}>자유 곡선</Button>
              <Button size="sm" variant="quiet" icon="polyline" active={d.mode === 'polyline'} onClick={() => p.onDrawMode('polyline')}>꼭짓점 찍기</Button>
            </div>
          ) : null}
          <p className="hint" style={{ marginTop: 8 }}>
            {p.mode === 'draw'
              ? d.mode === 'freehand' ? '지도 위에서 드래그하면 선이 그려집니다. 두 손가락으로는 지도를 움직일 수 있습니다.' : '클릭(탭)하면 꼭짓점이 추가됩니다. 더블클릭 또는 Esc로 선을 완료합니다. 키보드: Enter 추가 · Backspace 삭제.'
              : '이동 모드입니다. 점을 클릭하면 정보가 보입니다. 선을 그리려면 "그리기"를 누르세요.'}
          </p>
          {d.pending.length ? (
            <div className="row" style={{ marginTop: 8 }}>
              <span className="chip chip-primary num">꼭짓점 {d.pending.length}개</span>
              <Button size="sm" variant="primary" icon="check" onClick={p.onFinishPending} disabledReason={d.pending.length < 2 ? '꼭짓점이 2개 이상 필요합니다' : undefined}>선 완료</Button>
            </div>
          ) : null}
          <div className="row" style={{ marginTop: 10 }}>
            <Button size="sm" variant="quiet" icon="undo" onClick={p.onUndo} disabledReason={!d.undo.length && !d.pending.length ? '되돌릴 것이 없습니다' : undefined}>되돌리기</Button>
            <Button size="sm" variant="quiet" icon="redo" onClick={p.onRedo} disabledReason={!d.redo.length ? '다시 실행할 것이 없습니다' : undefined}>다시 실행</Button>
            <Button size="sm" variant="quiet" icon="trash" onClick={p.onDeleteSelected} disabledReason={!d.selectedLineId ? '목록에서 선을 먼저 선택하세요' : undefined}>선택 삭제</Button>
            <Button size="sm" variant="destructive" icon="trash" onClick={() => setConfirmClear(true)} disabledReason={!d.lines.length ? '지울 선이 없습니다' : undefined}>전체 지우기</Button>
          </div>
          {drawingKind === 'revised' && firstDone ? (
            <Button size="sm" variant="secondary" icon="copy" onClick={p.onCopyFirst} style={{ marginTop: 10 }}>최초 추론 복사해서 고치기</Button>
          ) : null}
          <div className="stack" style={{ marginTop: 12, gap: 4 }}>
            <div className="label">그린 선 <span className="num">{d.lines.length}/{MAX_LINES}</span> · 점 <span className="num">{totalPoints}</span></div>
            {d.lines.length >= MAX_LINES ? <p className="hint" role="status">선은 최대 {MAX_LINES}개까지 그릴 수 있습니다. 목록에서 고칠 선을 선택하고 ‘선택 삭제’를 누른 뒤 다시 그려 주세요. 제출한 최초 추론은 그대로 보관됩니다.</p> : null}
            {d.lines.map((l, i) => (
              <button key={l.id} type="button" className={'stage-item' + (d.selectedLineId === l.id ? ' is-current' : '')} onClick={() => p.onSelectLine(d.selectedLineId === l.id ? null : l.id)} aria-pressed={d.selectedLineId === l.id}>
                <span className="n">{i + 1}</span>
                <span>{l.mode === 'freehand' ? '자유 곡선' : '꼭짓점 선'} · 점 {l.points.length}개{l.rawPointCount > l.points.length ? ` (원본 ${l.rawPointCount})` : ''}</span>
              </button>
            ))}
            {!d.lines.length ? <span className="hint">아직 그린 선이 없습니다.</span> : null}
          </div>
          <div className="stack" style={{ marginTop: 14 }}>
            <Button variant="primary" icon="upload" onClick={() => setPreview(drawingKind)} disabledReason={!d.lines.length ? '선을 하나 이상 그려야 제출할 수 있습니다' : submitStatus.status === 'pending' ? '전송 중입니다' : undefined} loading={submitStatus.status === 'pending'}>
              {submitLabel}
            </Button>
            {submitStatus.message ? <span className={'tiny ' + (submitStatus.status === 'error' ? 'error-text' : submitStatus.status === 'saved' ? '' : 'muted')} role="status">{submitStatus.message}</span> : null}
            {drawingKind === 'first' && firstDone ? <span className="tiny muted">최초 추론은 {formatKst(p.state.record.firstGuess!.submittedAt)}에 제출되어 변경되지 않습니다.</span> : null}
          </div>
        </>
      ) : null}

      {!canDraw && p.inputLocked ? <p className="hint" style={{ marginTop: 12 }}><Icon name="lock" /> {p.lockedReason ?? '선생님이 입력을 잠갔습니다.'}</p> : null}
      {!canDraw && !p.inputLocked && drawingKind === 'none' && p.role !== 'teacher' ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="label">내 추론</div>
          <span className="small">{firstDone ? `최초 추론: 선 ${p.state.record.firstGuess!.guess.lines.length}개 · ${formatKst(p.state.record.firstGuess!.submittedAt)}` : '최초 추론: 아직 제출하지 않음'}</span>
          <span className="small">{p.state.record.revisedGuess ? `수정 추론: 선 ${p.state.record.revisedGuess.guess.lines.length}개 · ${formatKst(p.state.record.revisedGuess.submittedAt)}` : '수정 추론: 아직 제출하지 않음'}</span>
        </div>
      ) : null}

      {(p.stage === 'explain' || p.stage === 'wrapUp') && p.role !== 'teacher' ? (
        <ExplanationForm state={p.state} onSave={p.onExplanation} locked={!!p.inputLocked} />
      ) : null}

      <Dialog open={confirmClear} title="그린 선을 모두 지울까요?" onClose={() => setConfirmClear(false)} actions={<>
        <Button variant="secondary" onClick={() => setConfirmClear(false)}>취소</Button>
        <Button variant="destructive" icon="trash" onClick={() => { p.onClear(); setConfirmClear(false) }}>모두 지우기</Button>
      </>}>
        <p className="muted">선 {d.lines.length}개가 지워집니다. 되돌리기로 복구할 수 있습니다. 이미 제출한 추론은 바뀌지 않습니다.</p>
      </Dialog>

      <Dialog open={!!preview} title={preview === 'first' ? '최초 추론을 제출할까요?' : '수정 추론을 제출할까요?'} onClose={() => setPreview(null)} actions={<>
        <Button variant="secondary" onClick={() => setPreview(null)}>더 고치기</Button>
        <Button variant="primary" icon="upload" onClick={() => { const k = preview!; setPreview(null); p.onSubmit(k) }}>제출</Button>
      </>}>
        <p className="muted">선 {d.lines.length}개, 점 {totalPoints}개를 제출합니다.</p>
        {preview === 'first' ? <p className="muted">최초 추론은 제출 후 바뀌지 않습니다. 나중에 수정 추론을 따로 제출할 수 있습니다.</p> : <p className="muted">수정 추론은 다시 제출하면 마지막 것으로 바뀝니다. 최초 추론 기록은 그대로 남습니다.</p>}
      </Dialog>
    </div>
  )
}

function ExplanationForm({ state, onSave, locked }: { state: InquiryState; onSave: (t: string, l: string) => void; locked: boolean }) {
  const [text, setText] = useState(state.record.explanation?.text ?? '')
  const [limits, setLimits] = useState(state.record.explanation?.limitations ?? '')
  const dirty = text !== (state.record.explanation?.text ?? '') || limits !== (state.record.explanation?.limitations ?? '')
  return (
    <section className="stack" style={{ marginTop: 16 }}>
      <hr className="divider" />
      <div className="label">나의 설명</div>
      <p className="hint">담아 둔 관찰 증거를 인용하며 지진·화산 분포와 판 경계의 관련을 설명해 보세요. 이 글은 자동으로 채워지지 않습니다.</p>
      <textarea className="textarea" value={text} maxLength={MAX_TEXT} disabled={locked} onChange={(e) => setText(e.target.value)} placeholder="예: 증거 1에서 태평양 가장자리를 따라 지진이 띠를 이루고, 화산도 같은 띠 위에 ..." aria-label="나의 설명" />
      <div className="label">자료의 한계</div>
      <textarea className="textarea" style={{ minHeight: 80 }} value={limits} maxLength={MAX_TEXT} disabled={locked} onChange={(e) => setLimits(e.target.value)} placeholder="예: 규모 5.0 이상만 표시되어 작은 지진은 보이지 않는다. 화산 목록은 지금 분화 중인 목록이 아니다 ..." aria-label="자료의 한계" />
      <div className="row between">
        <span className="tiny muted num">{text.length}/{MAX_TEXT}</span>
        <Button size="sm" variant="primary" icon="check" onClick={() => onSave(text, limits)} disabledReason={locked ? '입력이 잠겨 있습니다' : !dirty ? '바뀐 내용이 없습니다' : undefined}>설명 저장</Button>
      </div>
    </section>
  )
}
