// 혼자 탐사용 상태 — 이 기기에 저장한다.
import { useEffect, useReducer } from 'react'
import { emptyRecord } from '@shared/domain/activity'
import { reducer, emptyDraft, type InquiryState } from './engine'
import { loadLocalRecord, saveLocalRecord } from './localStore'

export function useLocalInquiry(datasetVersion: string) {
  const [state, dispatch] = useReducer(reducer, datasetVersion, (dv): InquiryState => ({
    record: loadLocalRecord() ?? emptyRecord(dv),
    draft: emptyDraft('freehand'),
    submit: { kind: null, status: 'idle', message: null },
  }))
  useEffect(() => { saveLocalRecord(state.record) }, [state.record])
  return [state, dispatch] as const
}
