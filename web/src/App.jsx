// src/App.jsx
import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { TickerProvider } from './context/TickerContext'
import Layout    from './components/Layout'

// Each page loads on demand, so the first screen doesn't wait for the others
// (the Dashboard's chart library is the biggest piece).
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Scanner   = lazy(() => import('./pages/Scanner'))
const Positions = lazy(() => import('./pages/Positions'))
const Strategy  = lazy(() => import('./pages/Strategy'))

const pageLoading = (
  <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><div className="spinner" style={{ width: 36, height: 36 }} /></div>
)

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
      <TickerProvider>
        <Layout>
          <Suspense fallback={pageLoading}>
          <Routes>
            <Route path="/"          element={<Dashboard />} />
            <Route path="/scanner"   element={<Scanner />}   />
            <Route path="/positions" element={<Positions />} />
            {/* Manage was merged into Positions; keep old links working */}
            <Route path="/manage"    element={<Navigate to="/positions" replace />} />
            <Route path="/strategy"  element={<Strategy />}  />
            {/* Settings became Strategy; keep old links working */}
            <Route path="/settings"  element={<Navigate to="/strategy" replace />} />
          </Routes>
          </Suspense>
        </Layout>
      </TickerProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
