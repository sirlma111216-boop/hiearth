// 활동 화면 — 과제 안내 + 끼워 넣은 작업 공간 + 관찰 메모/선택 응답
import type { ReactNode } from 'react'
import type { LayerId, ScreenResponse } from '@shared/domain/types'
import { Workspace, type WorkspaceProps } from '../workspace/Workspace'

export interface ActivityTask {
  question: string
  hint?: string
  /** 체크리스트처럼 보여 줄 할 일 (완료 여부는 done 배열로) */
  steps?: string[]
  panels?: WorkspaceProps['panels']
  initialLayers?: Partial<Record<LayerId, boolean>>
  reveal?: 'volcano' | 'boundary' | null
  /** 관찰 메모 질문 (있으면 입력칸 표시) */
  notePrompt?: string
  /** 선택형 응답 */
  choices?: { prompt: string; options: string[]; multi?: boolean }
  /** 교사에게만 보이는 진행 팁 */
  teacherTip?: string
}

interface Props {
  task: ActivityTask
  done?: (boolean | undefined)[]
  workspace: Omit<WorkspaceProps, 'embedded' | 'panels' | 'reveal' | 'initialLayers'>
  response?: ScreenResponse
  onResponse?: (patch: { text?: string; choices?: string[] }) => void
  role: 'solo' | 'student' | 'teacher'
  inputLocked?: boolean
  children?: ReactNode
  /** 과제 머리 아래 안내(예: 선행 조건 미충족) */
  notice?: ReactNode
}

export function ActivityFrame({ task, done = [], workspace, response, onResponse, role, inputLocked, children, notice }: Props) {
  const choices = response?.choices ?? []
  const toggle = (opt: string) => {
    if (!onResponse) return
    const multi = task.choices?.multi !== false
    const next = choices.includes(opt) ? choices.filter((c) => c !== opt) : multi ? [...choices, opt] : [opt]
    onResponse({ choices: next })
  }
  return (
    <div>
      <div className="task">
        <div>
          <h2>{task.question}</h2>
          {task.hint ? <p>{task.hint}</p> : null}
        </div>
        {task.steps?.length ? (
          <div className="task-steps" aria-label="할 일">
            {task.steps.map((s, i) => <span key={s} className={done[i] ? 'ok' : ''}>{done[i] === undefined ? '•' : done[i] ? '✓' : '○'} {s}</span>)}
          </div>
        ) : null}
      </div>
      {notice}
      <div className="activity-stage">
        <Workspace {...workspace} embedded panels={{ banner: false, ...(task.panels ?? {}) }} reveal={task.reveal ?? null} initialLayers={task.initialLayers} defaultOpen={{ evidence: false, tools: task.panels?.tools !== false }} />
      </div>
      {role !== 'teacher' && (task.notePrompt || task.choices) ? (
        <div className="response">
          {task.choices ? (
            <>
              <div className="label">{task.choices.prompt}</div>
              <div className="choice-grid" role="group" aria-label={task.choices.prompt}>
                {task.choices.options.map((opt) => (
                  <label key={opt} className={'choice' + (choices.includes(opt) ? ' is-on' : '')}>
                    <input type={task.choices?.multi === false ? 'radio' : 'checkbox'} disabled={inputLocked} checked={choices.includes(opt)} onChange={() => toggle(opt)} />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>
            </>
          ) : null}
          {task.notePrompt ? (
            <>
              <label className="label" htmlFor="note">{task.notePrompt}</label>
              <textarea id="note" className="textarea" disabled={inputLocked} style={{ minHeight: 72 }} maxLength={600} value={response?.text ?? ''} placeholder="한두 문장이면 충분합니다." onChange={(e) => onResponse?.({ text: e.target.value })} />
            </>
          ) : null}
        </div>
      ) : null}
      {role === 'teacher' && task.teacherTip ? <div className="teacher-hint"><strong>진행 팁</strong> {task.teacherTip}</div> : null}
      {children}
    </div>
  )
}
