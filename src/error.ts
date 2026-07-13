/**
 * Typed errors: viem's error taste, adapted to errors-as-values.
 *
 * viem gives every failure a structured error you branch on by identity rather than by
 * string-matching a message. We want that discipline, but viem THROWS and we carry
 * errors as values (result.ts), so a `GuardError` is a plain typed object, not a class:
 * it serializes, needs no `instanceof`, and drops into a discriminated union or a
 * `Result`'s error slot. The load-bearing field is `code`, a stable branchable
 * discriminant; `cause` preserves the original throw so wrapping never loses the chain.
 */

/** A typed error carried as a value. Branch on `code`, not on `message`. */
export interface GuardError<Code extends string = string> {
  /** Stable, branchable discriminant. */
  readonly code: Code;
  /** Human-readable detail, for logs and messages, not for control flow. */
  readonly message: string;
  /** The originating error, when this wraps a throw. Preserves the chain. */
  // biome-ignore lint/plugin: a wrapped cause can be any thrown value
  readonly cause?: unknown;
}

/** Construct a typed `GuardError`, omitting `cause` when there is none. */
export function guardError<const Code extends string>(
  code: Code,
  message: string,
  // biome-ignore lint/plugin: a wrapped cause can be any thrown value
  cause?: unknown,
): GuardError<Code> {
  return cause === undefined ? { code, message } : { code, message, cause };
}
