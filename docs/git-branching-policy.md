# Trunk-Based Branch Policy

## Mainline rule

- `main` is the only long-lived branch.
- No long-running feature branches.

## Branch naming

- Feature: `codex/<module>/<ticket>-<desc>`
- Release freeze: `release/<yyyymmdd-or-week>`
- Hotfix from production tag: `hotfix/<ticket>`

## Merge cadence

- Feature branches are short-lived (target 1-3 days).
- Prefer small PRs and merge continuously.

## Release flow

1. cut `release/*` from `main` only when needed.
2. run full regression (`mainline-gate-matrix`: `contracts` + `week3-e2e-live`, plus local `module:test:release`).
3. tag production release.
4. back-merge fixes to `main`.

## Branch protection required checks (GitHub settings)

- `mainline-gate-matrix / contracts`
- `mainline-gate-matrix / week3-e2e-live`

## Emergency flow

1. cut `hotfix/*` from production tag.
2. patch and verify.
3. tag hotfix release.
4. cherry-pick or merge back to `main`.
