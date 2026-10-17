import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import './styles/base.css'
import './styles/print.css'
import { ToastProvider } from './ui/Toast'
import { TopBar } from './ui/TopBar'
import Landing from './pages/Landing'

const Explore = lazy(() => import('./pages/Explore'))
const Join = lazy(() => import('./pages/Join'))
const Room = lazy(() => import('./pages/Room'))
const Teach = lazy(() => import('./pages/Teach'))
const TeachRoom = lazy(() => import('./pages/TeachRoom'))
const Report = lazy(() => import('./pages/Report'))
const Sources = lazy(() => import('./pages/Sources'))
const Settings = lazy(() => import('./pages/Settings'))
const Showcase = lazy(() => import('./pages/Showcase'))

function NotFound() {
  return (
    <div className="page page-narrow"><TopBar /><div className="card stack"><h1 style={{ fontSize: 22 }}>페이지를 찾을 수 없습니다</h1><p className="muted">주소를 다시 확인하세요.</p><Link to="/" className="btn btn-primary">처음으로</Link></div></div>
  )
}

function Fallback() {
  return <div className="page" style={{ display: 'grid', placeItems: 'center' }}><span className="status-pill">불러오는 중…</span></div>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <Suspense fallback={<Fallback />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/join" element={<Join />} />
            <Route path="/room/:id" element={<Room />} />
            <Route path="/teach" element={<Teach />} />
            <Route path="/teach/:id" element={<TeachRoom />} />
            <Route path="/report/:id" element={<Report />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/showcase" element={<Showcase />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
