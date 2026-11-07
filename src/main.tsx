import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// capture mode: deterministic randomness so offline renders are reproducible
if (new URLSearchParams(location.search).has('capture')) {
  let a = 0x9e3779b9
  Math.random = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
