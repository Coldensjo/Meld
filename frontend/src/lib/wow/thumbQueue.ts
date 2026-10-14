// A work queue for thumbnails, which runs the nearest tiles first. Each key is worked once: the
// tiles on screen ask for it with their distance from the grid's centre as priority, and the grid
// prefetches the rows just outside the view at a lower priority, so scrolling finds them ready.
// A key that is asked for again while pending only gains the better priority and another listener.

interface Listener<T> {
  onReady: (v: T) => void
  onError: () => void
}

interface Job<T> {
  key: string
  priority: number
  listeners: Set<Listener<T>>
  /** Wanted by the grid's prefetch (kept pending without listeners until the set is replaced). */
  prefetch: boolean
}

export class ThumbQueue<T> {
  private pending = new Map<string, Job<T>>()
  /** Keys whose work has started, with its result. A failed key is dropped so it can be retried. */
  private results = new Map<string, Promise<T>>()
  private running = 0
  private work: (key: string) => Promise<T>
  private maxRunning: number

  constructor(work: (key: string) => Promise<T>, maxRunning = 3) {
    this.work = work
    this.maxRunning = maxRunning
  }

  /**
   * Asks for a key's result. Lower priority values run first. Returns a function that withdraws
   * the request; work that has started is not stopped, and the result is still kept for later.
   */
  request(key: string, priority: number, onReady: (v: T) => void, onError: () => void): () => void {
    const done = this.results.get(key)
    if (done) {
      done.then(onReady, onError)
      return () => {}
    }
    const listener: Listener<T> = { onReady, onError }
    const job = this.job(key, priority)
    job.listeners.add(listener)
    this.pump()
    return () => {
      job.listeners.delete(listener)
      if (job.listeners.size === 0 && !job.prefetch) this.pending.delete(key)
    }
  }

  /**
   * Replaces the set of keys to prepare ahead of time. Keys of the previous set that nobody asked
   * for are dropped if they have not started.
   */
  prefetch(wanted: { key: string; priority: number }[]) {
    const keep = new Set(wanted.map((w) => w.key))
    for (const [key, job] of this.pending) {
      if (!job.prefetch || keep.has(key)) continue
      job.prefetch = false
      if (job.listeners.size === 0) this.pending.delete(key)
    }
    for (const w of wanted) {
      if (this.results.has(w.key)) continue
      this.job(w.key, w.priority).prefetch = true
    }
    this.pump()
  }

  /** The number of keys waiting to start. */
  get pendingCount() {
    return this.pending.size
  }

  private job(key: string, priority: number): Job<T> {
    let job = this.pending.get(key)
    if (job) {
      job.priority = Math.min(job.priority, priority)
    } else {
      job = { key, priority, listeners: new Set(), prefetch: false }
      this.pending.set(key, job)
    }
    return job
  }

  private pump() {
    while (this.running < this.maxRunning && this.pending.size) {
      let next: Job<T> | undefined
      for (const job of this.pending.values()) if (!next || job.priority < next.priority) next = job
      if (!next) return
      this.pending.delete(next.key)
      this.running++
      const job = next
      const p = this.work(job.key)
      this.results.set(job.key, p)
      p.then(
        (v) => job.listeners.forEach((l) => l.onReady(v)),
        () => {
          this.results.delete(job.key)
          job.listeners.forEach((l) => l.onError())
        },
      ).finally(() => {
        this.running--
        this.pump()
      })
    }
  }
}
