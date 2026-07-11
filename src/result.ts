/**
 * Result: errors as values.
 *
 * The library does not throw for expected failures. An operation that can fail
 * returns a `Result`, so the failure is a typed value the caller has to handle.
 * Nothing gets silently swallowed by a stray `try/catch` and turned into an
 * accidental grant.
 *
 * Two shapes, kept separate on purpose:
 *   - `Result<T, E>` for operational failure (parsing, store I/O). Use this.
 *   - domain decisions (allow / deny-with-reason) are their own discriminated
 *     unions, not `Result`. A deny is a normal decision, not an error.
 *
 * `try/catch` is banned everywhere except the two converters below (see
 * `.biome/plugins/no-try-catch.grit`). Wrap throwing built-in or third-party
 * code once, here, and turn the throw into a `Result`.
 *
 * Prior art. Errors-as-values comes from Rust's `Result` and Haskell's
 * `Either`. In TypeScript the references are:
 *   - neverthrow (https://github.com/supermacro/neverthrow): the lightweight
 *     Result library this mirrors. `ok`/`err`/`Result`, and `tryCatch`/
 *     `tryCatchAsync` play the role of its `fromThrowable`/`fromPromise`.
 *   - Effect (https://effect.website): the larger effect system whose typed
 *     errors (tagged errors, `Either`) inform the approach.
 *
 * We bake our own minimal version instead of depending on either. A runtime
 * dependency would break the zero-dependency guarantee, which is part of the
 * security pitch. We take the four primitives we need, so the whole file reads
 * in one sitting, and skip the rest of those libraries' surface.
 */

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Wrap a success value. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Wrap a failure value. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

function toError(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error(String(caught));
}

/**
 * The single sanctioned synchronous throw-boundary. Runs `fn`, returning its
 * value as `ok` or any thrown value coerced to an `Error` as `err`.
 */
export function tryCatch<T>(fn: () => T): Result<T, Error> {
  // biome-ignore lint/plugin: the one sanctioned synchronous throw-boundary
  try {
    return ok(fn());
  } catch (caught) {
    return err(toError(caught));
  }
}

/** The single sanctioned asynchronous throw-boundary. */
export async function tryCatchAsync<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
  // biome-ignore lint/plugin: the one sanctioned asynchronous throw-boundary
  try {
    return ok(await fn());
  } catch (caught) {
    return err(toError(caught));
  }
}
