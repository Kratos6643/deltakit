import { useState } from 'react'
import type { TreeNode } from '../types.ts'
import { ChevronRightIcon } from './Icons.tsx'

const CHILD_STEP = 200

type TreeViewProps = {
  tree: TreeNode
  query: string
  showAll: boolean
  activeId: string | null
}

function haystack(node: TreeNode): string {
  return `${node.path}\n${node.key}\n${node.note ?? ''}\n${node.leftPreview ?? ''}\n${node.rightPreview ?? ''}`
}

function containsMatch(node: TreeNode, query: string): boolean {
  if (!query) return false
  if (haystack(node).toLowerCase().includes(query)) return true
  return node.children.some((child) => containsMatch(child, query))
}

function shown(node: TreeNode, showAll: boolean, query: string): boolean {
  if (query && containsMatch(node, query)) return true
  if (showAll) return true
  if (node.status !== 'same' || node.reordered || node.note) return true
  return node.children.some((child) => shown(child, showAll, query))
}

function statusClass(node: TreeNode): string {
  if (node.typeChange || node.reordered) return 'mod'
  if (node.status === 'added') return 'add'
  if (node.status === 'removed') return 'del'
  if (node.status === 'moved') return 'move'
  if (node.status === 'changed' || node.status === 'mixed') return 'mod'
  return 'same'
}

function Children({
  nodes,
  depth,
  query,
  showAll,
  activeId,
  overrides,
  onToggle,
}: {
  nodes: TreeNode[]
  depth: number
  query: string
  showAll: boolean
  activeId: string | null
  overrides: Record<string, boolean>
  onToggle: (id: string, open: boolean) => void
}) {
  const [limit, setLimit] = useState(CHILD_STEP)
  const activeIndex = activeId ? nodes.findIndex((node) => {
    const id = `node-${encodeURIComponent(node.id || 'root')}`
    return activeId === id || activeId.startsWith(`${id}.`) || activeId.startsWith(`${id}%5B`)
  }) : -1
  const visible = nodes.slice(0, Math.max(limit, activeIndex + 1))
  const hidden = nodes.length - visible.length
  return (
    <>
      {visible.map((child) => (
        <NodeView
          key={child.id || child.key}
          node={child}
          depth={depth}
          query={query}
          showAll={showAll}
          activeId={activeId}
          overrides={overrides}
          onToggle={onToggle}
        />
      ))}
      {hidden > 0 ? (
        <button type="button" className="show-more tree-more" style={{ marginLeft: 16 + depth * 18 }} onClick={() => setLimit((current) => current + CHILD_STEP)}>
          Show {Math.min(CHILD_STEP, hidden).toLocaleString()} more
          <span>{hidden.toLocaleString()} remaining</span>
        </button>
      ) : null}
    </>
  )
}

function NodeView({
  node,
  depth,
  query,
  showAll,
  activeId,
  overrides,
  onToggle,
}: {
  node: TreeNode
  depth: number
  query: string
  showAll: boolean
  activeId: string | null
  overrides: Record<string, boolean>
  onToggle: (id: string, open: boolean) => void
}) {
  const fallbackOpen = node.status !== 'same' || !!node.reordered || !!node.note
  const open = query ? containsMatch(node, query) || fallbackOpen : (overrides[node.id] ?? fallbackOpen)
  const leaf = node.children.length === 0
  const domId = `node-${encodeURIComponent(node.id || 'root')}`
  const tone = statusClass(node)

  return (
    <div className="tree-node" role="treeitem" aria-expanded={leaf ? undefined : open}>
      <div
        id={domId}
        className={`tree-row ${tone}${activeId === domId ? ' is-active' : ''}`}
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        {leaf ? <span className="twisty" /> : (
          <button type="button" className="twisty" aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} onClick={() => onToggle(node.id, !open)}>
            <ChevronRightIcon size={14} />
          </button>
        )}
        <span className={`dot ${tone}`} aria-hidden="true" />
        <span className="key">{node.key || '(root)'}</span>
        {node.note ? <em className="pill move">{node.note}</em> : null}
        {node.typeChange ? <em className="pill mod">type changed</em> : null}
        {node.reordered ? <em className="pill mod">key order</em> : null}
        {leaf ? (
          <span className="tree-values">
            {node.leftPreview && node.status !== 'same' ? <span className="before">{node.leftPreview}</span> : null}
            {node.leftPreview && node.rightPreview && node.status !== 'same' ? <span className="arrow" aria-hidden="true">→</span> : null}
            {node.rightPreview ? <span className={node.status === 'same' ? 'same' : 'after'}>{node.rightPreview}</span> : null}
            {!node.rightPreview && node.status === 'same' && node.leftPreview ? <span className="same">{node.leftPreview}</span> : null}
          </span>
        ) : null}
      </div>
      {open && !leaf ? (
        <div className="tree-kids" role="group">
          <Children
            nodes={node.children.filter((child) => shown(child, showAll, query))}
            depth={depth + 1}
            query={query}
            showAll={showAll}
            activeId={activeId}
            overrides={overrides}
            onToggle={onToggle}
          />
        </div>
      ) : null}
    </div>
  )
}

export function TreeView({ tree, query, showAll, activeId }: TreeViewProps) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const roots = tree.children.length > 0 ? tree.children.filter((child) => shown(child, showAll, query)) : [tree]

  return (
    <div className="tree" role="tree" aria-label="Structure">
      {roots.length === 0 ? (
        <div className="state">
          <strong>No structural changes</strong>
          <p>Turn on Show unchanged to browse every branch.</p>
        </div>
      ) : null}
      <Children
        nodes={roots}
        depth={0}
        query={query}
        showAll={showAll}
        activeId={activeId}
        overrides={overrides}
        onToggle={(id, open) => setOverrides((current) => ({ ...current, [id]: open }))}
      />
    </div>
  )
}
