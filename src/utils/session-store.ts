import type { Session } from 'fastify';

/** Expire abandoned browser sessions and put a ceiling on retained state. */
export class ExpiringSessionStore {
  private readonly entries = new Map<string, { session: Session; expires: number }>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(
    private readonly ttl = 24 * 60 * 60 * 1000,
    private readonly capacity = 10_000
  ) {
    this.timer = setInterval(
      () => {
        const now = Date.now();
        for (const [id, entry] of this.entries) {
          if (entry.expires <= now) {
            this.entries.delete(id);
          }
        }
      },
      Math.min(ttl, 60_000)
    );
    this.timer.unref();
  }
  get size(): number {
    return this.entries.size;
  }
  set(id: string, session: Session, callback: (error?: Error) => void): void {
    this.entries.delete(id);
    if (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
    this.entries.set(id, { session, expires: Date.now() + this.ttl });
    callback();
  }
  get(id: string, callback: (error: Error | null, session: Session | null) => void): void {
    const entry = this.entries.get(id);
    if (entry && entry.expires <= Date.now()) {
      this.entries.delete(id);
    }
    callback(null, this.entries.get(id)?.session ?? null);
  }
  destroy(id: string, callback: (error?: Error) => void): void {
    this.entries.delete(id);
    callback();
  }
  close(): void {
    clearInterval(this.timer);
    this.entries.clear();
  }
}
