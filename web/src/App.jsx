// src/App.jsx
import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { MarketProvider } from './context/MarketContext'
import { ThemeProvider } from './context/ThemeContext'
import { TickerProvider } from './context/TickerContext'
import { ToastProvider } from './context/ToastContext'
import Layout from './components/Layout'
import { Spinner } from './components/ui'

// Each page loads on demand, so the first screen doesn't wait for the others
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Scanner   = lazy(() => import('./pages/Scanner'))
const Positions = lazy(() => import('./pages/Positions'))
const Strategy  = lazy(() => import('./pages/Strategy'))
const Performance = lazy(() => import('./pages/Performance'))

const pageLoading = <div className="flex justify-center py-20 text-muted"><Spinner className="h-8 w-8" /></div>

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
      <ToastProvider>
      <AuthProvider>
      <MarketProvider>
      <TickerProvider>
        <Layout>
          <Suspense fallback={pageLoading}>
          <Routes>
            <Route path="/"          element={<Dashboard />} />
            <Route path="/scanner"   element={<Scanner />}   />
            <Route path="/positions" element={<Positions />} />
            {/* Manage was merged into Positions; keep old links working */}
            <Route path="/manage"    element={<Navigate to="/positions" replace />} />
            <Route path="/performance" element={<Performance />} />
            <Route path="/strategy"  element={<Strategy />}  />
            {/* Settings became Strategy; keep old links working */}
            <Route path="/settings"  element={<Navigate to="/strategy" replace />} />
          </Routes>
          </Suspense>
        </Layout>
      </TickerProvider>
      </MarketProvider>
      </AuthProvider>
      </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
