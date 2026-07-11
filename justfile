# x402-server-guard — repo command index.
#
# Dev tooling (build/test/lint) is canonical in package.json scripts; the
# recipes below that delegate to `npm run` exist only so `just --list` shows
# the whole picture. Everything else here is repo *operations* that have no
# npm home — supply-chain checks, CI, release prep.
#
# Run `just` (no args) to list every command.

default:
    @just --list

# --- dev loop (npm scripts are canonical; these just delegate) ---

# Full local gate: typecheck + lint + file-length + tests.
check:
    npm run check

# Build the package with tsc.
build:
    npm run build

# Run the test suite.
test:
    npm test

# --- supply-chain / CI operations ---

# Resolve a GitHub Action tag to its current commit SHA (for pinning).
# Usage: just action-sha actions/checkout v4
action-sha repo ref:
    gh api repos/{{repo}}/commits/{{ref}} --jq '.sha'

# Verify every SHA-pinned action in .github/workflows against its live tag.
verify-pins:
    #!/usr/bin/env bash
    set -euo pipefail
    grep -rhoE 'uses: [^@ ]+@[0-9a-f]{40} # [^ ]+' .github/workflows/ | sort -u \
      | while read -r _ spec; do
          repo="${spec%@*}"
          rest="${spec#*@}"
          pinned="${rest%% *}"
          tag="${spec##*# }"
          current="$(gh api "repos/${repo}/commits/${tag}" --jq '.sha')"
          if [ "$pinned" = "$current" ]; then
            echo "ok    ${repo}@${tag}"
          else
            echo "STALE ${repo}@${tag}: pinned ${pinned:0:12} but ${tag} = ${current:0:12}"
          fi
        done

# Open the current branch's PR in a browser.
pr:
    gh pr view --web

# --- release ---

# Create a changeset describing the current change.
changeset:
    npm run changeset

# Show exactly what a publish would include, without publishing.
publish-dry:
    npm publish --dry-run
