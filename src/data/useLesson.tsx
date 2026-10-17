import { useEffect, useState } from 'react'
import { loadLessonData, type LessonData } from './lesson'

export function useLesson() {
  const [data, setData] = useState<LessonData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ loaded: number; total: number; label: string }>({ loaded: 0, total: 1, label: '자료 준비' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setError(null)
    loadLessonData((loaded, total, label) => { if (alive) setProgress({ loaded, total, label }) })
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : '자료를 불러오지 못했습니다.') })
    return () => { alive = false }
  }, [attempt])
  return { data, error, progress, retry: () => setAttempt((a) => a + 1) }
}

export function LoadingScreen({ progress, error, onRetry, title = '관측 자료를 준비하는 중' }: { progress: { loaded: number; total: number; label: string }; error: string | null; onRetry: () => void; title?: string }) {
  const pct = Math.round((progress.loaded / Math.max(1, progress.total)) * 100)
  return (
    <div className="page page-narrow" style={{ display: 'grid', placeItems: 'center', minHeight: '100svh' }}>
      <div className="card stack" style={{ width: 'min(520px, 100%)' }} role="status" aria-live="polite">
        <span className="eyebrow">Earth Atelier</span>
        <h1 style={{ fontSize: 22 }}>{error ? '자료를 불러오지 못했습니다' : title}</h1>
        {error ? (
          <>
            <p className="error-text">{error}</p>
            <p className="muted small">네트워크 상태를 확인한 뒤 다시 시도하세요. 저장된 수업 자료는 서버 연결 없이도 앱과 함께 제공됩니다.</p>
            <button type="button" className="btn btn-primary" onClick={onRetry}>다시 시도</button>
          </>
        ) : (
          <>
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(243,240,231,0.12)', overflow: 'hidden' }}><div style={{ width: pct + '%', height: '100%', background: 'var(--primary)', transition: 'width 200ms' }} /></div>
            <span className="muted small num">{progress.label} · {pct}%</span>
          </>
        )}
      </div>
    </div>
  )
}
