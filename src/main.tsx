import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/plus-jakarta-sans'
import './index.css'
import App from './App.tsx'
import { pageFromLocation, upgradeLegacyLink } from './lib/routes.ts'
import { applyTheme, initialTheme } from './lib/theme.ts'
import { preloadTool } from './tools/pages.ts'

applyTheme(initialTheme())
upgradeLegacyLink()
// A link straight to a tool starts loading that tool before the first render.
preloadTool(pageFromLocation())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
