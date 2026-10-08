import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// One typeface, bundled with the app (no Google Fonts request); numbers use its tabular figures
import '@fontsource-variable/geist'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
