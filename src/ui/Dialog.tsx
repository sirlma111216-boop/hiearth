import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './Button'

export function Dialog({ open, title, children, onClose, actions }: { open: boolean; title: string; children?: ReactNode; onClose: () => void; actions?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const first = ref.current?.querySelector<HTMLElement>('button, input, textarea, select, a[href]')
    first?.focus()
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" ref={ref}>
        <h2 id="dlg-title">{title}</h2>
        <div className="stack" style={{ marginTop: 8 }}>{children}</div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
          {actions ?? <Button variant="secondary" onClick={onClose}>닫기</Button>}
        </div>
      </div>
    </div>
  )
}
