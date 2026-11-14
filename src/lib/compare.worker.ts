import type { CompareInput } from '../types.ts'
import { compare, emptyResult } from './compare.ts'
import { errorMessage } from './values.ts'

addEventListener('message', (event: MessageEvent<{ id: number; input: CompareInput }>) => {
  const { id, input } = event.data
  try {
    const result = compare(input.mode, input.left, input.right, input.leftName, input.rightName, input.options)
    postMessage({ id, result })
  } catch (error) {
    postMessage({ id, result: emptyResult(`These files could not be compared: ${errorMessage(error)}`) })
  }
})

postMessage({ ready: true })
