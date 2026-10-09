import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Spinner } from './components/ui/primitives'
import Create from './pages/Create'

/* The studio and the bank are heavy and rarely opened in the same sitting as
   the editor, so they load on demand. */
const Bank = lazy(() => import('./pages/Bank'))
const Studio = lazy(() => import('./pages/Studio'))
const View = lazy(() => import('./pages/View'))

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas font-vazir text-ink-3">
      <span className="flex items-center gap-2 text-sm font-bold">
        <Spinner />
        در حال بارگذاری…
      </span>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/create" replace />} />
          <Route path="/create" element={<Create />} />
          <Route path="/bank" element={<Bank />} />
          <Route path="/view/:id" element={<View />} />
          <Route path="/studio/:presId/:slideId/:stepId" element={<Studio />} />
          <Route path="*" element={<Navigate to="/create" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
