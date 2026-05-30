// src/api/client.js
import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  timeout: 120000,
})

export const getPortfolio    = ()            => api.get('/portfolio')
export const getSettings     = ()            => api.get('/settings')
export const getPositions    = (ticker)      => api.get('/positions',     { params: ticker ? { ticker } : {} })
export const getAllPositions  = (ticker)      => api.get('/positions/all', { params: ticker ? { ticker } : {} })
export const addPosition     = (data)        => api.post('/positions', data)
export const closePosition   = (id)          => api.post('/positions/close', { position_id: id })
export const runScan         = (config)      => api.post('/scan', config)
export const savePositions   = (data)        => api.post('/scan/save', data)
export const getManagement   = (ticker)      => api.get('/manage',        { params: ticker ? { ticker } : {} })

export default api
