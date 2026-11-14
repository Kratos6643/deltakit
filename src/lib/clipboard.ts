export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the selection-based copy below.
    }
  }
  // The async clipboard API only exists on HTTPS and localhost, so plain-HTTP hosts use the older path.
  const previous = document.activeElement
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  area.remove()
  if (previous instanceof HTMLElement) previous.focus()
  return copied
}

export function copyAndTell(text: string, label: string, notify: (message: string) => void) {
  void copyText(text).then((ok) => notify(ok ? `${label} copied` : 'The browser blocked copying. Select the text and copy it instead.'))
}

export function downloadText(filename: string, text: string, type = 'text/plain;charset=utf-8') {
  download(filename, new Blob([text], { type }))
}

export function downloadBytes(filename: string, bytes: Uint8Array, type = 'application/octet-stream') {
  download(filename, new Blob([bytes as Uint8Array<ArrayBuffer>], { type }))
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
