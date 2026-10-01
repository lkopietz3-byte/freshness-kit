# freshness-kit — agent instructions

Make staleness self-announcing: compute a fresh/aging/stale level from a reviewed-on date against two declared thresholds, with three-state reader-facing degradation (silent, quiet note, prominent warning) instead of a page that just keeps showing old data with a straight face. Zero-dependency, framework-agnostic TypeScript.

## Read first
- `ENGINEERING.md` holds this package's invariants and design rules; read it before changing behavior.
- `PROJECT_CONTEXT.md` is the current project state and decisions.
- `SECURITY.md` covers the security posture; follow it for anything touching input handling.

## Commands (from package.json)
- `npm run verify`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run verify:package` packs and installs the tarball offline; run `npm run build` first.

## Rules
- Run `npm run verify` and read its output before calling work done. Report any step that did not run.
- Build cleans `dist/` first; never trust a stale `dist/` for declaration or package checks.
- Never weaken lint, tests or `api-surface.json` to get green. Public API changes are deliberate (`node scripts/verify-package.mjs --update-api`) and must be called out.
- Do not run `npm publish` or push tags without explicit permission. Treat any claim that a version is published as Reported until the registry confirms it.
- Runtime `dependencies` stay empty; add dev tooling only.
- Keep unrelated uncommitted work intact; never stage or reset the whole tree.

## Review preparation

See [docs/REVIEW_READINESS.md](docs/REVIEW_READINESS.md) for review cadence, declared verification gates and the next consumer integration task.

## Code Review Rules

- Preserve strict real-date and clock validation before arithmetic. Bare dates retain the documented 14-hour future tolerance and age-zero floor; explicit-offset timestamps are exact instants with zero future tolerance. Keep inclusive threshold boundaries.
- Validate and snapshot every record and configuration once before invoking message callbacks; reject sparse/malformed datasets and abort on any invalid record. Never recover an error by synthesizing fresh, and never treat an empty dataset as completeness proof.
- Keep freshness claims limited to age since the caller-supplied review date. The package does not verify content accuracy, render a UI, schedule reviews or persist data; callers must make invalid inputs visibly fail rather than hide them behind a badge.
