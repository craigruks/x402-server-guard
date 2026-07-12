/**
 * A URL-keyed shared cache, the way a CDN or reverse proxy fronts an origin.
 *
 * It keys on the request URL alone and stores whatever it is told to store; it
 * has no notion of who paid. Modeling exactly that blind spot is the point: if a
 * paid response is written here, the cache will replay it to the next caller for
 * the same URL, paid or not.
 */
export class SharedCache<T> {
  private readonly store = new Map<string, T>();
  private hits = 0;

  /** Read a URL from the cache, counting a hit when one is present. */
  read(url: string): T | undefined {
    const value = this.store.get(url);
    if (value !== undefined) {
      this.hits += 1;
    }
    return value;
  }

  /** Store a response under a URL, as a shared cache does for a cacheable 200. */
  write(url: string, value: T): void {
    this.store.set(url, value);
  }

  /** How many reads were served from the cache. */
  get hitCount(): number {
    return this.hits;
  }
}
