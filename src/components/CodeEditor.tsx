import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { jsonLanguage } from '@codemirror/lang-json'
import { xmlLanguage } from '@codemirror/lang-xml'
import { yamlLanguage } from '@codemirror/lang-yaml'
import { bracketMatching, HighlightStyle, LanguageSupport, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Mode } from '../types.ts'

type CodeEditorProps = {
  value: string
  mode: Mode
  label: string
  testId: string
  wrap: boolean
  readOnly: boolean
  maxLength?: number
  onChange?: (value: string) => void
  onTooLong?: () => void
}

const LANGUAGES: Partial<Record<Mode, LanguageSupport>> = {
  json: new LanguageSupport(jsonLanguage),
  xml: new LanguageSupport(xmlLanguage),
  yaml: new LanguageSupport(yamlLanguage),
}

const highlight = HighlightStyle.define([
  { tag: [tags.propertyName, tags.tagName, tags.angleBracket], color: 'var(--tok-key)' },
  { tag: [tags.string, tags.attributeValue], color: 'var(--tok-str)' },
  { tag: [tags.number, tags.attributeName], color: 'var(--tok-num)' },
  { tag: [tags.bool, tags.null, tags.keyword, tags.typeName, tags.labelName, tags.character], color: 'var(--tok-lit)' },
  { tag: [tags.comment, tags.meta, tags.processingInstruction, tags.documentMeta], color: 'var(--faint)' },
  { tag: tags.invalid, color: 'var(--del)' },
])

// Colors come from the page's CSS variables, so the editor follows the light and dark themes.
const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--text)', fontSize: '12.5px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '20px' },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': { border: 'none', backgroundColor: 'var(--surface-2)', color: 'var(--faint)', fontSize: '11px' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '40px', padding: '0 8px' },
  '.cm-activeLine': { backgroundColor: 'var(--hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--muted)' },
  '&:not(.cm-focused) .cm-activeLine': { backgroundColor: 'transparent' },
  '&:not(.cm-focused) .cm-activeLineGutter': { color: 'inherit' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent)', marginLeft: '-1px' },
  '.cm-selectionBackground': { background: 'color-mix(in srgb, var(--accent) 16%, transparent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    background: 'color-mix(in srgb, var(--accent) 28%, transparent)',
  },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
  '.cm-searchMatch': { backgroundColor: 'var(--mod-bg)', outline: '1px solid var(--mod-strong)' },
  '.cm-searchMatch-selected': { backgroundColor: 'var(--mod-strong)', outlineColor: 'var(--mod)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent-ring)' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--del-bg-2)' },
  '.cm-specialChar': { color: 'var(--del)' },
  '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text)' },
  '.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel.cm-search': { padding: '6px 36px 6px 10px', fontFamily: 'var(--sans)' },
  '.cm-panel.cm-search label': { color: 'var(--muted)', fontSize: '12px' },
  '.cm-panel.cm-search [name=close]': { top: '7px', right: '12px', color: 'var(--muted)', fontSize: '18px', lineHeight: '1' },
  '.cm-textfield': {
    height: '26px',
    padding: '0 8px',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    backgroundColor: 'var(--surface)',
    fontFamily: 'var(--mono)',
    fontSize: '12px',
  },
  '.cm-textfield:focus': { borderColor: 'var(--accent)', outline: 'none', boxShadow: '0 0 0 3px var(--accent-soft)' },
  '.cm-button': {
    height: '26px',
    padding: '0 10px',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    backgroundImage: 'none',
    backgroundColor: 'var(--surface)',
    fontSize: '12px',
  },
  '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--surface-3)' },
})

const setup: Extension = [
  lineNumbers({ formatNumber: (line) => String(line).padStart(2, '0') }),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  drawSelection(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  bracketMatching(),
  search({ top: true }),
  syntaxHighlighting(highlight),
  EditorState.tabSize.of(2),
  // Mod-Enter runs Compare, Convert, or Decode, so the editor leaves it to the page.
  keymap.of([...defaultKeymap.filter((binding) => binding.key !== 'Mod-Enter'), ...searchKeymap, indentWithTab]),
  theme,
]

const EDITABLE: Extension = [history(), keymap.of(historyKeymap)]
const READ_ONLY: Extension = [EditorState.readOnly.of(true), EditorView.contentAttributes.of({ inputmode: 'none' })]

const language = new Compartment()
const wrapping = new Compartment()
const editing = new Compartment()
const labels = new Compartment()

// Marks text that came in through the value prop, so it is never reported back as an edit.
const External = Annotation.define<boolean>()

export function CodeEditor({ value, mode, label, testId, wrap, readOnly, maxLength, onChange, onTooLong }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const shown = useRef(value)
  const latest = useRef({ onChange, onTooLong, maxLength })

  useEffect(() => {
    latest.current = { onChange, onTooLong, maxLength }
  })

  useLayoutEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: shown.current,
        extensions: [
          setup,
          language.of([]),
          wrapping.of([]),
          editing.of([]),
          labels.of([]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || update.transactions.some((tr) => tr.annotation(External))) return
            shown.current = update.state.doc.toString()
            latest.current.onChange?.(shown.current)
          }),
          EditorView.domEventHandlers({
            paste(event, editor) {
              const limit = latest.current.maxLength
              const pasted = event.clipboardData?.getData('text/plain') ?? ''
              if (limit === undefined || pasted.length + editor.state.doc.length <= limit) return false
              latest.current.onTooLong?.()
              return true
            },
            // A dropped file replaces the pane and its name, which the pane itself handles.
            drop: (event) => Boolean(event.dataTransfer?.files.length),
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        language.reconfigure(LANGUAGES[mode] ?? []),
        wrapping.reconfigure(wrap ? EditorView.lineWrapping : []),
        editing.reconfigure(readOnly ? READ_ONLY : EDITABLE),
        labels.reconfigure(EditorView.contentAttributes.of({ 'aria-label': label, 'data-testid': testId })),
      ],
    })
  }, [mode, wrap, readOnly, label, testId])

  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view || value === shown.current) return
    shown.current = value
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: 0 },
      annotations: External.of(true),
    })
    // New text starts at its first line. Scrolling the pane itself leaves the page where it is.
    view.scrollDOM.scrollTo(0, 0)
  }, [value])

  return <div ref={hostRef} className="code-editor" />
}
