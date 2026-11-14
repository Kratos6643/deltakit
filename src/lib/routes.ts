import type { MouseEvent } from 'react'

export type Tool = 'compare' | 'convert' | 'decode' | 'lists'
export type Page = 'home' | Tool | 'help'

export const PATHS: Record<Page, string> = {
  home: '/',
  compare: '/compare',
  convert: '/convert',
  decode: '/decode',
  lists: '/lists',
  help: '/help',
}

export const PAGES = Object.keys(PATHS) as Page[]

// Files or pasted text handed from the Home page to a tool. `at` is when the hand-off happened,
// so a tool can tell a new hand-off from one it already took.
export type Handoff = {
  at: number
  files: { name?: string; text: string }[]
}

function pageFromPath(pathname: string): Page | undefined {
  const name = pathname.replace(/\/+$/, '').toLowerCase()
  return PAGES.find((page) => PATHS[page] === (name || '/'))
}

export function pageFromLocation(): Page {
  return pageFromPath(window.location.pathname) ?? 'home'
}

// Plain clicks stay in the app; clicks with a modifier key open the page in a new tab as usual.
export function followLink(event: MouseEvent<HTMLAnchorElement>, go: (page: Page) => void, page: Page) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  go(page)
}

// Links from before the pages had their own paths used #convert and #decode.
export function upgradeLegacyLink() {
  const { pathname, search, hash } = window.location
  const legacy = hash.replace(/^#\/?/, '').toLowerCase()
  const page = pageFromPath(pathname)
  if (page === 'home' && (legacy === 'compare' || legacy === 'convert' || legacy === 'decode')) {
    window.history.replaceState(null, '', `${PATHS[legacy]}${search}`)
  } else if (page === undefined) {
    window.history.replaceState(null, '', `/${search}`)
  }
}
