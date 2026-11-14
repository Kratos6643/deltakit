import { useEffect, useRef, useState } from 'react'
import type { CompareInput, CompareResult } from '../types.ts'
import { compare, emptyResult } from './compare.ts'

export type Comparison = { input: CompareInput; result: CompareResult }

type Job = { id: number; input: CompareInput }

const RESTART_AFTER_MS = 800

function run(input: CompareInput): CompareResult {
  return compare(input.mode, input.left, input.right, input.leftName, input.rightName, input.options)
}

// Comparing runs in a worker so a large file never blocks typing or scrolling.
// Only the newest request matters: while one job runs, later ones replace each other,
// and a job that outlives RESTART_AFTER_MS is dropped by restarting the worker.
class CompareClient {
  #worker: Worker | null = null
  #ready = false
  #broken = false
  #running: { job: Job; startedAt: number } | null = null
  #queued: Job | null = null
  #sequence = 0
  #publish: (comparison: Comparison) => void

  constructor(publish: (comparison: Comparison) => void) {
    this.#publish = publish
  }

  submit(input: CompareInput) {
    this.#sequence += 1
    const job = { id: this.#sequence, input }
    const running = this.#running
    if (!running) {
      this.#post(job)
    } else if (performance.now() - running.startedAt > RESTART_AFTER_MS) {
      this.#reset()
      this.#post(job)
    } else {
      this.#queued = job
    }
  }

  dispose() {
    this.#reset()
    this.#queued = null
  }

  #reset() {
    this.#worker?.terminate()
    this.#worker = null
    this.#ready = false
    this.#running = null
  }

  // A worker that fails before saying it is ready never loaded (for example, a host
  // serving the script with the wrong type), so comparing falls back to this thread.
  #spawn(): Worker | null {
    if (this.#broken || typeof Worker === 'undefined') return null
    try {
      const worker = new Worker(new URL('./compare.worker.ts', import.meta.url), { type: 'module' })
      worker.addEventListener('message', (event: MessageEvent<{ ready: true } | { id: number; result: CompareResult }>) => {
        if ('ready' in event.data) this.#ready = true
        else this.#settle(event.data.id, event.data.result)
      })
      worker.addEventListener('error', (event) => {
        event.preventDefault()
        const running = this.#running
        const loaded = this.#ready
        this.#reset()
        if (!loaded) {
          this.#broken = true
          if (running) this.#post(running.job)
          return
        }
        if (running) this.#settle(running.job.id, emptyResult('These files are too large to compare in this browser tab.'), running.job)
      })
      return worker
    } catch {
      this.#broken = true
      return null
    }
  }

  #post(job: Job) {
    if (!this.#worker) this.#worker = this.#spawn()
    if (!this.#worker) {
      this.#running = { job, startedAt: performance.now() }
      window.setTimeout(() => this.#settle(job.id, run(job.input)), 0)
      return
    }
    this.#running = { job, startedAt: performance.now() }
    this.#worker.postMessage(job)
  }

  #settle(id: number, result: CompareResult, fallback?: Job) {
    const current = this.#running?.job.id === id ? this.#running.job : undefined
    const job = current ?? fallback
    if (!job) return
    if (current) this.#running = null
    this.#publish({ input: job.input, result })
    const next = this.#queued
    this.#queued = null
    if (next) this.#post(next)
  }
}

export function useComparison(input: CompareInput): { comparison: Comparison; pending: boolean } {
  const [comparison, setComparison] = useState<Comparison>(() => ({ input, result: run(input) }))
  const [client] = useState(() => new CompareClient(setComparison))
  const initial = useRef(input)

  useEffect(() => () => client.dispose(), [client])

  useEffect(() => {
    if (input !== initial.current) client.submit(input)
  }, [client, input])

  return { comparison, pending: comparison.input !== input }
}
