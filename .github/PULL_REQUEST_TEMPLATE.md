<!--
Keep this short. Delete any heading that does not apply.
Not for security fixes: those go through a private advisory first. See SECURITY.md.
-->

## What this changes

<!-- One or two sentences. Why, not what. The diff shows what. -->

## Verification

<!--
What you ran, and what passed. Name the commands.
Reading the code and reasoning about it is not verification.
-->

- Ran:
- Passed:
- Not verified, and why:

## Risk

<!--
Delete if this touches only docs, tests, or tooling.

If it changes the public API, the store contract, or the settlement path, say
what breaks if it is wrong, and how to undo it after release. A published API
shape cannot be taken back with a revert.
-->

## Checklist

- [ ] `npm run check` passes locally
- [ ] New behaviour has a test that fails without the change
- [ ] Public API changes are documented, or none were made
- [ ] No new runtime dependencies, or the reason is stated above

## AI assistance

<!--
Optional, and not held against the change. If most of this was generated, say so,
so the review can check for invented APIs and fabricated expected values.
See CONTRIBUTING.md.
-->
