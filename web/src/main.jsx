import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Bundled with the app (no Google Fonts request): Geist for reading, with tabular figures for
// numbers; Newsreader (optical sizes) for the big amounts and headings
import '@fontsource-variable/geist'
import '@fontsource-variable/newsreader/opsz.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
