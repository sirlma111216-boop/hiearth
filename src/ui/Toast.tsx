import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

export interface ToastItem { id: number; text: string; kind: 'info' | 'success' | 'danger'; action?: { label: string; onClick: () => void } }

const ToastContext = createContext<{ push: (text: string, kind?: ToastItem['kind'], action?: ToastItem['action']) => void }>({ push: () => {} })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const push = useCallback((text: string, kind: ToastItem['kind'] = 'info', action?: ToastItem['action']) => {
    const id = ++seq.current
    setItems((list) => [...list.slice(-3), { id, text, kind, action }])
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), kind === 'danger' ? 7000 : 4200)
  }, [])
  const value = useMemo(() => ({ push }), [push])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-host" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span className="grow">{t.text}</span>
            {t.action ? (
              <button type="button" className="btn btn-quiet btn-sm" onClick={t.action.onClick}>{t.action.label}</button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
