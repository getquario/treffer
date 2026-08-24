# treffer

Tiny, bounded RFC 9485 I-Regexp matcher for JavaScript. Zero runtime dependencies, plain JS + JSDoc, hand-written declarations checked against the source with `checkJs`.

## Commands

- `npm run check` — reproduces the complete pull-request quality gate locally: format, lint, dead-code analysis, bundle size, unit tests, deterministic fuzz regression, and browser CSP coverage. **There is no build step.**
- `npm run fmt` — oxfmt, formatting every file it understands: JS, TS, JSON, Markdown and HTML. `npm run fmt:check` is the CI form and runs first in `check`, being the cheapest step.
- `npm run lint` — oxlint, configured entirely in `.oxlintrc.json` — the default (correctness) ruleset plus the **type-aware** rules, with `denyWarnings` on, so any warning fails. Both switches live in `options` there rather than on the command line, so an editor's oxlint integration enforces exactly what `npm run lint` does. Type-awareness is a second binary, the `oxlint-tsgolint` devDependency, which oxlint shells out to — that is why dependabot's `lint` group matches `oxlint-*` beside `oxlint`, and why a checkout without it silently drops the type-aware rules instead of failing.
- `npm run knip` — knip, twice: a default run with `--treat-config-hints-as-errors`, then a `--production` run. They catch disjoint things. The default run sees the whole repo — every dependency, and every file and export reachable from the suites — and catches what nothing imports at all. The production run drops tests and `devDependencies` from the graph, so it catches the export only a _test_ imports: dead in the shipped package, invisible to the default run because a test import is still an import. Config hints fail the default run and are suppressed in production, so that flag belongs only on the first; what they buy here is a stale `entry` or `ignoreUnresolved` line failing loudly rather than quietly matching nothing. `knip.jsonc` holds the whole config: `entry` for the roots reached by `node <path>` or `jazzer <path>` instead of by import, and `ignoreUnresolved` for the served paths the browser page imports, which name no file on disk. There is deliberately **no `ignoreDependencies`**: `@jazzer.js/bug-detectors` stays visible because the `--customHooks` module that imports it is a registered entry. The entry list names the fuzz files by kind rather than as `fuzz/*.js` so a shared helper added later lands outside `entry`, where knip still checks its exports. The gate's one real blind spot: `lib/` is a single `index.js` and it is the package entry, so no library export is export-checked in either mode — a dead public export is still a reviewer's job.
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
10. Size is a soft goal. Never remove a safety check to save bytes, and **never shorten a name to save them either** — a consumer's minifier mangles every binding regardless of how it is spelled here, so short internal names buy nothing. Since `lib/` ships verbatim, those names are what appear in a consumer's stack trace. Object _property_ names are the exception: minifiers cannot rename them, so `Matcher.char` and `Nfa.states` do cost real bytes — spend them anyway when they buy clarity, and raise the budget deliberately.

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

- **oxfmt owns formatting, on its own defaults** — 2-space indent, double quotes, 100-column width. There is no `.oxfmtrc.json` and adding one should need a reason, not a preference. Indentation, quoting and line breaking are not decisions anyone makes here; run `npm run fmt`. This replaced a hand-maintained terse style, so do not reintroduce manual alignment or single-line blocks — the formatter will undo them.
- Unit tests use `node:test` and live in `test/*.test.js`; the Playwright CSP test lives in `test/browser/`.
- New syntax or safety behavior needs unit tests and structured fuzz coverage.
- Keep the fuzz differential oracle restricted to short patterns and subjects so the native comparison engine cannot become a fuzzing bottleneck.
- Runtime support is Node.js 22.12+ (unflagged `require(esm)`), **ESM only**, plus ES2024 browser environments through a standards-based ESM bundler. There is no CommonJS, direct-script global, or UMD build — shipping two formats would split the diagnostics WeakSet/WeakMap across a `require`/`import` seam, which no config can fix.
- Suggested commit messages must follow Conventional Commits and be at most 80 characters.
- **There is no build.** `lib/` is published verbatim — `files` is just `["lib"]` and `exports` points straight at `lib/index.js`. Consumers get readable source and real stack traces; their own bundler does the minifying. Do not reintroduce a bundler to ship smaller bytes: measured on the tsdown build this replaced, the bundled result was identical to within 6 bytes.
- The declaration is hand-written in `lib/index.d.ts`, beside the code it describes. It is **not** generated: `tsc` cannot keep `@internal` JSDoc typedefs out of emitted declarations ([TypeScript #38444](https://github.com/microsoft/TypeScript/issues/38444)), so generating would publish the internal AST and NFA types as API. dts-buddy has the same flaw. ESLint and execa hand-write theirs for the same reason.
- **`checkJs` over `lib/` is what keeps that declaration honest.** `tsconfig.json` type-checks `lib/**/*.js` under full `strict` including `noImplicitAny`. The public types are declared once in `lib/index.d.ts` and pulled into the implementation with `@import`, so a signature that drifts from what ships fails to compile; only internal types (`Node`, `State`, `Frag`, `Matcher`, `Nfa`) are local `@typedef`s. `fault()` and `cap()` take `TrefferErrorCode`, so a code this module throws but the declaration omits fails to compile. Verify with: swap a thrown code for a made-up one and confirm `npm run test:types` fails.
- `attw` runs with `--profile esm-only`, which skips the `node10` and `node16-cjs` resolution modes — the two this package deliberately does not support. `node16` (ESM) and `bundler` must stay green.
- **`no-unused-expressions` is suppressed per line, never per glob.** The `cond || bad()` guard idiom trips it ~25 times in `lib/index.js`, each carrying its own suppression. Do not "tidy" these into one `.oxlintrc.json` override: the rule staying live in that file is what still catches a genuinely dead statement there, and a glob would silently give that up. Verify by adding `PROP;` next to a suppressed line and confirming `npm run lint` fails.
- **Suppressions use `oxlint-disable-next-line`, never the trailing `-line` form.** A trailing comment is anchored to a physical line, and oxfmt moves lines: when the formatter first ran, 6 of the 25 trailing suppressions stopped covering their expression and `npm run lint` failed. Two more needed the comment placed _inside_ the block, directly above the guarded expression, because the enclosing statement was split. If a suppression ever stops working after a formatting change, that is the cause. The type-aware rules take the same treatment and the same `typescript/` prefix they are reported under (`// oxlint-disable-next-line typescript/unbound-method`); most of those suppressions sit on a prototype method captured to restore in a `finally`, which the rule cannot tell from one about to be called.
- Bindings are named for readers: `chars` not `s`, `pos` not `i`, `states` not `st`, `preds` not `ps`. True loop counters (`j`) stay single letters. Rename with a scope-aware tool, never `sed` — a bare `s` occurs inside strings, comments and unrelated scopes. Watch shorthand properties especially: renaming the binding in `{ c }` silently renames the _property_ too, which is how `Matcher.c` became `Matcher.char`.
- `.fuzz-corpus/` and generated fuzz artifacts are not committed.
