# treffer

Tiny, bounded RFC 9485 I-Regexp matcher for JavaScript. Zero runtime dependencies, plain JS + JSDoc, hand-written declarations checked against the source with `checkJs`.

## Commands

- `npm run check` — reproduces the complete pull-request quality gate locally: lint, bundle size, unit tests, deterministic fuzz regression, and browser CSP coverage. **There is no build step.**
- `npm run lint` — oxlint on its default (correctness) ruleset with `--deny-warnings`, so any warning fails. It runs first in `check` because it is the cheapest step.
- **Non-negotiable: run `npm run check` before declaring any work done.** Passing unit tests alone is not done — a change is complete only when the full gate above is green. Never say "done", close an issue, or hand off without it.
- `npm test` — `test:unit` (Node's built-in test runner under `--disallow-code-generation-from-strings`, a strict-CSP simulation), then `test:types`: a plain `tsc` that type-checks `lib/` **and** `test/types.check.ts` in one pass, followed by `attw` against a packed tarball to catch module-resolution mistakes the compiler cannot see. Keep this on Node: Bun accepts that V8 flag but does not enforce it.
- `npm run size` — size-limit bundles and minifies `lib/index.js` itself, then checks it against the budget in `package.json`. It measures what a consumer's bundler would ship rather than a file on disk, so it still catches a dependency accidentally being pulled in.
- `npm run test:browser` — serves `lib/` straight to Playwright Chromium under a strict CSP.
- Run a single suite: `node --disallow-code-generation-from-strings --test test/match.test.js`
- `npm run bench` — runs zero-dependency compile, match, search, and scaling benchmarks against `lib/`.
- `npm run fuzz` — runs compile, match, and structured fuzz targets for 60 seconds each.
- `npm run fuzz:regression` — replays the committed corpus.

## Architecture

The implementation lives in `lib/index.js`, which is also exactly what ships — `lib/` is published as-is, unminified and unbundled. `parse()` checks RFC 9485 syntax and produces a small internal tree. `build()` compiles that tree to a Thompson NFA. `run()` simulates active states as sets and computes epsilon closures with visited-state tracking.

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
10. Size is a soft goal. Never remove a safety check to save bytes, and **never shorten a name to save them either** — a consumer's minifier mangles every binding regardless of how it is spelled here, so short internal names buy nothing. Since `lib/` ships verbatim, those names are what appear in a consumer's stack trace. Object *property* names are the exception: minifiers cannot rename them, so `Matcher.char` and `Nfa.states` do cost real bytes — spend them anyway when they buy clarity, and raise the budget deliberately.

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
- **There is no build.** `lib/` is published verbatim — `files` is just `["lib"]` and `exports` points straight at `lib/index.js`. Consumers get readable source and real stack traces; their own bundler does the minifying. Do not reintroduce a bundler to ship smaller bytes: measured on the tsdown build this replaced, the bundled result was identical to within 6 bytes.
- The declaration is hand-written in `lib/index.d.ts`, beside the code it describes. It is **not** generated: `tsc` cannot keep `@internal` JSDoc typedefs out of emitted declarations ([TypeScript #38444](https://github.com/microsoft/TypeScript/issues/38444)), so generating would publish the internal AST and NFA types as API. dts-buddy has the same flaw. ESLint and execa hand-write theirs for the same reason.
- **`checkJs` over `lib/` is what keeps that declaration honest.** `tsconfig.json` type-checks `lib/**/*.js` under full `strict` including `noImplicitAny`. The public types are declared once in `lib/index.d.ts` and pulled into the implementation with `@import`, so a signature that drifts from what ships fails to compile; only internal types (`Node`, `State`, `Frag`, `Matcher`, `Nfa`) are local `@typedef`s. `fault()` and `cap()` take `TrefferErrorCode`, so a code this module throws but the declaration omits fails to compile. Verify with: swap a thrown code for a made-up one and confirm `npm run test:types` fails.
- `attw` runs with `--profile esm-only`, which skips the `node10` and `node16-cjs` resolution modes — the two this package deliberately does not support. `node16` (ESM) and `bundler` must stay green.
- **`no-unused-expressions` is suppressed per line, never per glob.** The `cond || bad()` guard idiom trips it ~25 times in `lib/index.js`, each carrying its own `// oxlint-disable-line no-unused-expressions`. Do not "tidy" these into one `.oxlintrc.json` override: the rule staying live in that file is what still catches a genuinely dead statement there, and a glob would silently give that up. Verify by adding `PROP;` next to a suppressed line and confirming `npm run lint` fails.
- Bindings are named for readers: `chars` not `s`, `pos` not `i`, `states` not `st`, `preds` not `ps`. True loop counters (`j`) stay single letters. Rename with a scope-aware tool, never `sed` — a bare `s` occurs inside strings, comments and unrelated scopes. Watch shorthand properties especially: renaming the binding in `{ c }` silently renames the *property* too, which is how `Matcher.c` became `Matcher.char`.
- `.fuzz-corpus/` and generated fuzz artifacts are not committed.
