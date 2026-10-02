// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { TickerProvider } from './context/TickerContext'
import Layout    from './components/Layout'
import Dashboard from './pages/Dashboard'
import Scanner   from './pages/Scanner'
import Positions from './pages/Positions'
import Strategy  from './pages/Strategy'

export default function App() {
  return (
    <BrowserRouter>
      <TickerProvider>
        <Layout>
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
        </Layout>
      </TickerProvider>
    </BrowserRouter>
  )
}
