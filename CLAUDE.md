# treffer

Tiny, bounded RFC 9485 I-Regexp matcher for JavaScript. Zero runtime dependencies, plain JS + JSDoc, hand-written declarations checked against the source with `checkJs`.

## Commands

- `npm run check` — reproduces the complete pull-request quality gate locally: build, bundle size, unit tests, deterministic fuzz regression, and browser CSP coverage.
- **Non-negotiable: run `npm run check` before declaring any work done.** Passing unit tests alone is not done — a change is complete only when the full gate above is green. Never say "done", close an issue, or hand off without it.
- `npm test` — `test:unit` (Node's built-in test runner under `--disallow-code-generation-from-strings`, a strict-CSP simulation), then `test:types`, a plain `tsc` that type-checks `src/` **and** `test/types.check.ts` in one pass. No build needed. Keep this on Node: Bun accepts that V8 flag but does not enforce it.
- `npm run build` — tsdown creates a minified ESM bundle targeting ES2024 in `dist/`, and tsdown's `copy` carries the hand-written `src/index.d.ts` in beside it.
- `npm run size` — checks both bundles against the budgets in `package.json`.
- `npm run test:browser` — builds the package and runs the browser bundle in Playwright Chromium under a strict CSP.
- Run a single suite: `node --disallow-code-generation-from-strings --test test/match.test.js`
- `npm run bench` — runs zero-dependency compile, match, search, and scaling benchmarks against `src/`.
- `npm run fuzz` — runs compile, match, and structured fuzz targets for 60 seconds each.
- `npm run fuzz:regression` — replays the committed corpus.

## Architecture

The implementation lives in `src/index.js`. `parse()` checks RFC 9485 syntax and produces a small internal tree. `build()` compiles that tree to a Thompson NFA. `run()` simulates active states as sets and computes epsilon closures with visited-state tracking.

`compile(pattern)` returns an object with `match(subject)` and `search(subject)`. The one-shot exports compile and run in one call. Strict RFC behavior is the default; `{ anchors: true }` enables `^` and `$` as a compatibility extension.

## Hard constraints

1. Matcher runtime must stay bounded. Never pass attacker-controlled patterns and subjects to a backtracking matcher.
2. Preserve the limits for pattern scalars, parser depth, repetition expansion, NFA states, subject scalars, and state transitions.
3. Character-class predicate checks count toward the transition budget.
4. Epsilon closure must use visited-state tracking so nullable cycles terminate.
5. Substring search adds the start state during one forward pass. Do not restart matching over every suffix.
6. Pattern and subject iteration uses Unicode scalar values. Lone surrogates are errors.
7. Treffer is a checking RFC 9485 implementation. Reject unsupported JavaScript syntax rather than interpreting it.
8. `^` and `$` are literals in strict mode. Anchor behavior requires `{ anchors: true }`.
9. Keep zero runtime dependencies and CSP safety.
10. Size is a soft goal. Never remove a safety check to save bytes.

## Omakase pragmatism

Apply this across the whole project: implementation, API design, tests, documentation, dependencies, and tooling. Prefer cohesive defaults and one obvious path over knobs, abstraction, or infrastructure. Test the guarantee users rely on directly, and add complexity only when concrete pressure justifies it. These preferences never weaken hard boundedness or safety constraints.

## Limits

- 4,096 pattern Unicode scalar values
- 64 nested groups
- 4,096 NFA states
- 1,024 expanded repetitions
- six digits per quantifier bound
- one million subject Unicode scalar values
- one million state transitions per match

Syntax errors throw `SyntaxError`, invalid API values throw `TypeError`, and resource limits throw `RangeError`.

## Conventions

- Tabs in JavaScript.
- Unit tests use `node:test` and live in `test/*.test.js`; the Playwright CSP test lives in `test/browser/`.
- New syntax or safety behavior needs unit tests and structured fuzz coverage.
- Keep the fuzz differential oracle restricted to short patterns and subjects so the native comparison engine cannot become a fuzzing bottleneck.
- Runtime support is Node.js 22.12+ (unflagged `require(esm)`), **ESM only**, plus ES2024 browser environments through a standards-based ESM bundler. There is no CommonJS, direct-script global, or UMD build — shipping two formats would split the diagnostics WeakSet/WeakMap across a `require`/`import` seam, which no config can fix.
- Suggested commit messages must follow Conventional Commits and be at most 80 characters.
- The declaration is hand-written in `src/index.d.ts`, beside the code it describes; type generation stays disabled (`dts: false`) and tsdown's `copy` carries it into `dist/`. `dist/` is the **only** thing published — `files` is just `["dist"]`.
- **`checkJs` over `src/` is what keeps that declaration honest.** `tsconfig.json` type-checks `src/**/*.js` with `noImplicitAny` off — that setting is the difference between 2 real errors and a flood of `noImplicitAny` noise. `fault()` and `cap()` take `TrefferErrorCode`, so a code this module throws but `src/index.d.ts` omits fails to compile. Verify with: swap a thrown code for a made-up one and confirm `npm run test:types` fails.
- `dist/`, `.fuzz-corpus/`, and generated fuzz artifacts are not committed.
