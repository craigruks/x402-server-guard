/**
 * Result: errors as values.
 *
 * The library does not throw for expected failures. An operation that can fail returns
 * a `Result`, so the failure is a typed value the caller has to handle, and nothing is
 * silently swallowed by a stray `try/catch` and turned into an accidental grant.
 *
 * Operational failure (parsing, store I/O) is a `Result<T, E>`. Domain decisions
 * (allow / deny-with-reason) are their own discriminated unions, not `Result`: a deny
 * is a normal decision, not an error.
 *
 * `try/catch` is banned everywhere except the two converters below (see
 * `.biome/plugins/no-try-catch.grit`). Wrap throwing code once, here.
 *
 * Prior art: Rust's `Result`, Haskell's `Either`, and in TypeScript neverthrow and
 * Effect. We bake our own four primitives rather than take a runtime dependency, which
 * would break the zero-dependency guarantee that is part of the security pitch.
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

// biome-ignore lint/plugin: a caught value is typed unknown by the language
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
