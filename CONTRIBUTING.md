# Contributing

```sh
mise install     # Node 24, matching CI
npm ci
npm run check    # typecheck, lint, file length, tests
```

If `npm run check` passes, your change is ready to open as a pull request.

## Setup

1. Install [mise](https://mise.jdx.dev) and run `mise install`. This pins Node to
   the version CI develops on.
2. Run `npm ci` in the repository root.
3. Run `npm run check`. A clean checkout passes.

Three packages carry their own lockfiles: the root package, `website/` (the docs
site), and `e2e/` (the on-chain harness). Run `npm ci` in the directory you are
changing. Do not run `npm install` at the root and expect the other two to update.

To run the on-chain attack reproductions, see [`e2e/README.md`](./e2e/README.md).
They need Foundry, which `mise install` provides inside `e2e/`.

`just --list` shows every repo operation that has no npm home, such as
supply-chain checks and release prep.

## What passes review

`npm run check` is the local gate. CI runs more:

1. `npm run test:coverage`, which enforces 100% statement, branch, function, and
   line coverage on `src/`.
2. `npm run build`, `npm run check:pkg`, and a smoke test of the compiled `dist/`.
3. Both documented examples, which throw if the guard ever grants twice.
4. The `e2e/` typecheck.
5. The fork tests, in a separate workflow. That one is informational, not blocking.

## Rules that will fail review

Lint plugins or CI enforce all of these, so they surface before review does.

1. **No new runtime dependencies.** The published package has none. A new
   development dependency needs a stated reason: what it saves, what it weighs,
   and what it costs to maintain.
2. **No bare `unknown`.** Where a value genuinely has no type, such as a caught
   error or an untyped protocol boundary, justify it inline with
   `// biome-ignore lint/plugin: <reason>`.
3. **No `try`/`catch`.** Return a `Result` instead, or wrap the throwing call once
   with `tryCatch` or `tryCatchAsync` from `src/result.ts`.
4. **No source file over 200 lines.** Split it.
5. **Exact dependency versions.** No carets, no tildes. Dependabot handles bumps.

## Contributions we accept

Best fit, in order:

1. A reproduction of an attack the library claims to mitigate, or one it misses.
2. A bug fix with a test that fails before the fix and passes after.
3. A binding for a framework the library does not cover yet.
4. Documentation that corrects something wrong or unclear.

Please open an issue before writing a new mitigation or changing the public API.
The threat model in [`docs/coverage-map.md`](./docs/coverage-map.md) is the scope,
and a mitigation outside it needs a discussion first, not a pull request first.

Two things we will decline: new runtime dependencies, and changes that widen the
public API without a use case behind them. Pre-1.0 API surface is cheap to add
and expensive to remove.

## Security reports do not go here

Do not open a public issue for a suspected vulnerability. Report it privately
through GitHub Security Advisories, using "Report a vulnerability" on the
Security tab. [`SECURITY.md`](./SECURITY.md) has the full policy and the
disclosure window.

A public issue that describes a working attack discloses it before a fix exists.

## AI-assisted contributions

AI coding tools are allowed. Review the output before you open the pull
request. This code runs on a payment path, where an incorrect nonce check or
settlement guard loses funds.

If you used one:

1. **Read every line before you open the pull request.** If you have not verified
   it yourself, open it as a draft.
2. **Check the payment logic against the spec**, not against what the model
   remembered. Do not invent header names, field names, or chain constants. The
   codebase has them.
3. **Cut the filler.** Review removes generated comments that restate the code,
   and pull request descriptions padded to sound thorough.
4. **Make the tests assert behaviour.** A test that only asserts a function does
   not throw does not cover the behaviour.
5. **Say so in the description** if most of the change was generated. This is not
   held against the change. It tells the reviewer to check for invented APIs and
   fabricated expected values.

Contributions that read as unreviewed output may be closed without a detailed
review.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`,
`docs:`, `chore:`, `ci:`, `test:`. Keep the subject under 72 characters. The body
explains why, because the diff already shows what.

Repository writing rules, which apply to commit messages, pull request text, code
comments, and docs:

1. No em dashes. Use a comma, a period, a colon, or parentheses.
2. Proper sentences, capitalised.
3. No marketing voice. No "seamless", "robust", "powerful", or "leverage".

In the pull request description, name the commands you ran and state what
passed. If you did not verify something, say which part and why.

Pull requests are squash-merged. Branch history does not need to be tidy. The
pull request title becomes the commit subject, so write that one carefully.

## Response times

One person maintains this project, part time. Expect a first response within
seven days. If a week passes with no reply, comment on the thread again.

Merging is at the maintainer's discretion, weighed on the risk the change
carries and the quality of its tests. A change to the settlement path is held to
a harder standard than a documentation fix.

## Code of conduct

Participation is covered by the [Contributor Covenant](./CODE_OF_CONDUCT.md).
The reporting contact is in that file.

## Licence

Contributions are licensed under the [MIT Licence](./LICENSE), the same terms as
the project.
