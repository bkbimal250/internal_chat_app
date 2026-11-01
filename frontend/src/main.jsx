import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/app/App.jsx'
import { canonicalAppUrl } from '@/lib/canonical-host'
import '@/styles/globals.css'

const redirectTo = canonicalAppUrl()
if (redirectTo) {
  window.location.replace(redirectTo)
} else {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
