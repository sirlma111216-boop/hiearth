import { useEffect, useState } from 'react'

/** 서버 기록은 그대로 수용하되, 확인되지 않은 자동 저장 입력은 별도로 유지한다. */
export function useAutosaveDraft<T>(confirmed: T, locked: boolean, save: (value: T) => Promise<boolean>, delay: number) {
  const [draft, setDraft] = useState<T>()
  const [acknowledged, setAcknowledged] = useState<{ value: T }>()
  useEffect(() => {
    // 전송 중 원래 값으로 되돌린 경우도 저장 확인을 기다려야 이전 전송이 덮어쓰지 않는다.
    if (draft !== undefined && acknowledged?.value === draft && JSON.stringify(confirmed) === JSON.stringify(draft)) setDraft(undefined)
  }, [confirmed, draft, acknowledged])

  useEffect(() => {
    if (draft === undefined || locked) return
    const timer = setTimeout(() => {
      void save(draft).then(ok => { if (ok) setAcknowledged({ value: draft }) })
    }, delay)
    return () => clearTimeout(timer)
  }, [draft, locked, save, delay])

  return [draft ?? confirmed, setDraft] as const
}
