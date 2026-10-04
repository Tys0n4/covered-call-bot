import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts ship with the app (no Google Fonts request): Syne for titles, Geist for text, Geist Mono for numbers
import '@fontsource-variable/syne'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
