export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

export function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'date'
  return typeof value
}

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortKeys(item))
  if (!isPlainObject(value)) return value
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) sorted[key] = sortKeys(value[key])
  return sorted
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function cellText(value: unknown): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (value instanceof Date) return value.toISOString()
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

export function displayValue(value: unknown, limit = 140): string {
  let text: string
  if (value === undefined) text = ''
  else if (typeof value === 'string') text = JSON.stringify(value)
  else if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    text = JSON.stringify(value) ?? 'null'
  } else if (value instanceof Date) text = value.toISOString()
  else {
    try {
      text = JSON.stringify(sortKeys(value)) ?? ''
    } catch {
      text = Object.prototype.toString.call(value)
    }
  }
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1)}…`
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const line = error.message.split('\n')[0]?.trim() || 'Could not parse this file'
    return line.length > 240 ? `${line.slice(0, 239)}…` : line
  }
  return 'Could not parse this file'
}

export function jsonError(text: string, error: unknown): string {
  const message = errorMessage(error)
  const match = /position (\d+)/i.exec(message)
  if (!match) return `Invalid JSON — ${message}`
  const position = Number(match[1])
  const head = text.slice(0, position)
  const line = head.split('\n').length
  const column = position - head.lastIndexOf('\n')
  return `Invalid JSON at line ${line}, column ${column}`
}
