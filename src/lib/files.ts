export const MAX_BYTES = 5 * 1024 * 1024

export const TEXT_ACCEPT = '.txt,.json,.xml,.yaml,.yml,.csv,.tsv,.md,.log,.diff,.patch,.jwt,text/*,application/json,application/xml'

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10_240 ? 1 : 0)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

// Rejects with a message that can be shown as is.
export async function readTextFile(file: File): Promise<string> {
  if (file.size > MAX_BYTES) {
    throw new Error(`${file.name} is ${formatBytes(file.size)}. DeltaKit opens files up to ${formatBytes(MAX_BYTES)}.`)
  }
  let content: string
  try {
    content = await file.text()
  } catch {
    throw new Error(`${file.name} could not be read. Try opening it again.`)
  }
  if (content.slice(0, 8000).includes('\u0000')) {
    throw new Error(`${file.name} looks like a binary file. DeltaKit reads text files such as .txt, .json, .xml, .yaml, and .csv.`)
  }
  return content
}
