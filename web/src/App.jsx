// src/App.jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { TickerProvider } from './context/TickerContext'
import Layout    from './components/Layout'
import Dashboard from './pages/Dashboard'
import Scanner   from './pages/Scanner'
import Positions from './pages/Positions'
import Manage    from './pages/Manage'
import Settings  from './pages/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <TickerProvider>
        <Layout>
          <Routes>
            <Route path="/"          element={<Dashboard />} />
            <Route path="/scanner"   element={<Scanner />}   />
            <Route path="/positions" element={<Positions />} />
            <Route path="/manage"    element={<Manage />}    />
            <Route path="/settings"  element={<Settings />}  />
          </Routes>
        </Layout>
      </TickerProvider>
    </BrowserRouter>
  )
}
