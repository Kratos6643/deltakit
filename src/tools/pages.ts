import { createElement, useEffect, useState, type ComponentType } from 'react'
import type { Handoff, Page, Tool } from '../lib/routes.ts'

type ToolProps = { active: boolean; notify: (text: string) => void; incoming?: Handoff }

// Each tool is its own chunk, and its page renders as soon as that chunk is in.
// React.lazy would hold a page behind its loading state for up to 300 ms, even when the chunk is quicker.
function toolPage(load: () => Promise<ComponentType<ToolProps>>) {
  let loaded: ComponentType<ToolProps> | undefined
  let pending: Promise<void> | undefined
  const preload = () => (pending ??= load().then((component) => {
    loaded = component
  }))

  function ToolPage(props: ToolProps) {
    const [failed, setFailed] = useState(false)
    const [, setReady] = useState(false)
    // The chunk can arrive between this render and its effect, so a render that showed the loading text always waits for it.
    const Component = loaded
    useEffect(() => {
      if (!Component) preload().then(() => setReady(true), () => setFailed(true))
    }, [Component])
    if (Component) return createElement(Component, props)
    const text = failed ? 'This page couldn’t load. Check your connection, then reload.' : 'Loading…'
    return createElement('p', { className: 'page-loading', role: 'status', hidden: !props.active }, text)
  }

  return { Page: ToolPage, preload }
}

export const TOOL_PAGES: Record<Tool, ReturnType<typeof toolPage>> = {
  compare: toolPage(() => import('./CompareTool.tsx').then((module) => module.CompareTool)),
  convert: toolPage(() => import('./ConvertTool.tsx').then((module) => module.ConvertTool)),
  decode: toolPage(() => import('./DecodeTool.tsx').then((module) => module.DecodeTool)),
  lists: toolPage(() => import('./ListsTool.tsx').then((module) => module.ListsTool)),
}

export function preloadTool(page: Page): Promise<void> {
  if (page === 'home' || page === 'help') return Promise.resolve()
  return TOOL_PAGES[page].preload().catch(() => undefined)
}
