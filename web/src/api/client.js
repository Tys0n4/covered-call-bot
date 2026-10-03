// src/api/client.js
import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  timeout: 120000,
})

// Login token (see api/auth.py). Sent with every request; a 401 means it's
// missing or expired, so drop it and tell the app to show the login screen.
const TOKEN_KEY = 'auth_token'
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }
export const setToken = (t) => { try { localStorage.setItem(TOKEN_KEY, t) } catch { /* storage unavailable */ } }
export const clearToken = () => { try { localStorage.removeItem(TOKEN_KEY) } catch { /* storage unavailable */ } }
export const AUTH_LOGOUT_EVENT = 'auth:logout'

api.interceptors.request.use(config => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401 && !err.config?.url?.startsWith('/auth/')) {
      clearToken()
      window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT))
    }
    return Promise.reject(err)
  },
)

export const getAuthStatus   = ()            => api.get('/auth/status')
export const login           = (password)    => api.post('/auth/login', { password })

export const getPortfolio    = ()            => api.get('/portfolio')
export const getStrategy     = ()            => api.get('/settings')
export const saveStrategy    = (data)        => api.put('/settings', data)
export const getPositions    = (ticker)      => api.get('/positions',     { params: ticker ? { ticker } : {} })
export const getAllPositions  = (ticker)      => api.get('/positions/all', { params: ticker ? { ticker } : {} })
export const addPosition     = (data)        => api.post('/positions', data)
export const closePosition   = (id, closeCost = null, closeFees = null) =>
  api.post('/positions/close', { position_id: id, close_cost: closeCost, close_fees: closeFees })
export const rollPosition    = (id, data)    => api.post(`/positions/${id}/roll`, data)
export const assignPosition  = (id)          => api.post(`/positions/${id}/assign`, {})
export const markNotAssigned = (id)          => api.post(`/positions/${id}/not-assigned`)
export const getAssignmentReview = ()        => api.get('/positions/assignment-review')
export const editPosition    = (id, data)    => api.patch(`/positions/${id}`, data)
export const undoPosition    = (id)          => api.post(`/positions/${id}/undo`)
export const runScan         = (config)      => api.post('/scan', config)
export const savePositions   = (data)        => api.post('/scan/save', data)
export const getManagement   = (ticker)      => api.get('/manage',        { params: ticker ? { ticker } : {} })
export const getPerformance  = ()            => api.get('/performance')

// Your stock holdings (saved to the database by the API)
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
