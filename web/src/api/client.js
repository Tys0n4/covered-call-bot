// src/api/client.js
import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  timeout: 120000,
})

export const getPortfolio    = ()            => api.get('/portfolio')
export const getStrategy     = ()            => api.get('/settings')
export const saveStrategy    = (data)        => api.put('/settings', data)
export const getPositions    = (ticker)      => api.get('/positions',     { params: ticker ? { ticker } : {} })
export const getAllPositions  = (ticker)      => api.get('/positions/all', { params: ticker ? { ticker } : {} })
export const addPosition     = (data)        => api.post('/positions', data)
export const closePosition   = (id, closeCost = null) => api.post('/positions/close', { position_id: id, close_cost: closeCost })
export const runScan         = (config)      => api.post('/scan', config)
export const savePositions   = (data)        => api.post('/scan/save', data)
export const getManagement   = (ticker)      => api.get('/manage',        { params: ticker ? { ticker } : {} })

// Your stock holdings (saved to app/data/portfolio.csv by the API)
export const addHolding      = (data)        => api.post('/portfolio', data)
export const updateHolding   = (ticker, data) => api.put(`/portfolio/${encodeURIComponent(ticker)}`, data)
export const deleteHolding   = (ticker)      => api.delete(`/portfolio/${encodeURIComponent(ticker)}`)

// Turn an API error into one readable sentence
export function apiError(e, fallback = 'Something went wrong. Is the API running?') {
  const d = e?.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d) && d.length) {
    const field = d[0].loc?.[d[0].loc.length - 1]
    return field ? `${field.replace('_', ' ')}: ${d[0].msg}` : d[0].msg
  }
  return fallback
}

export default api
