# treffer

Tiny, bounded RFC 9485 I-Regexp matcher for JavaScript. Plain JS + JSDoc, one runtime dependency. `lib/index.js` is the implementation and the package.

Work is done when `npm run check` is green. Scripts live in `package.json`. Run them on Node: Bun accepts `--disallow-code-generation-from-strings` but does not enforce it. A single suite is `node --disallow-code-generation-from-strings --test test/match.test.js`. Public syntax, API, and the numeric limits live in `README.md`; the host-facing surface (diagnostic identity, `relocate`, the `span` form) lives in `EMBEDDING.md`.

## Architecture

`parse()` checks RFC 9485 syntax and produces a small internal tree. `compile()` lowers that tree to a Thompson NFA. `run()` simulates active states as sets and computes epsilon closures with visited-state tracking.

`compile(pattern)` returns `{ match(subject), search(subject) }`. The one-shot exports compile and run in one call. Strict RFC behavior is the default; `{ anchors: true }` enables `^` and `$`.

## Safety

- Matcher runtime stays bounded. Attacker-controlled patterns and subjects never go to a backtracking matcher.
- Keep the limits for pattern scalars, parser depth, repetition expansion, NFA states, subject scalars, and state transitions. Character-class predicate checks count toward the transition budget.
- Epsilon closure uses visited-state tracking so nullable cycles terminate.
- Substring search adds the start state during one forward pass. Do not restart matching over every suffix.
- Pattern and subject iteration uses Unicode scalar values. Lone surrogates are errors.
- Unsupported JavaScript syntax is rejected, not interpreted.
- `^` and `$` are literals in strict mode. Anchor behavior requires `{ anchors: true }`.
- Compose closures that already exist in the shipped source. Source-scan tests grep `lib/` for `\beval\b`, `Function(`, and `new Function`, so comments in `lib/` have to avoid those spellings. The suite runs under `--disallow-code-generation-from-strings`.

Size is a soft goal (budget in `package.json`). Name bindings for readers; a consumer minifier mangles them anyway, and `lib/` ships verbatim so those names show up in stack traces. Property names do not mangle (`Matcher.char`, `Nfa.states`): spend them when they buy clarity, and raise the budget on purpose. Keep the limit and the passing test; then check `npm run size`.

## Semantics

`test/` is the executable spec. Limits and error codes live in `README.md`. These look like bugs if you tidy them:

- Syntax errors throw `SyntaxError`, invalid API values throw `TypeError`, resource limits throw `RangeError`.
- Strict mode treats `^` and `$` as literals. `{ anchors: true }` is the CTS-compatible extension padvinder needs.
- Resource-limit failures are `RangeError` with a `TrefferErrorCode`; they are not silent no-matches at this layer. Callers such as padvinder convert them to false.
- Diagnostics are minted, authenticated and relocated through [waarmerk](https://github.com/getquario/waarmerk). padvinder shares it; xprsn and sjabloon still hand-roll their own copies and are being moved over. `store()` at module load, `mint`/`capped` to throw, `relocate` re-exported with this module's store applied. Do not hand-roll a second copy of that machinery here — it drifted four ways before it was extracted.
- `BUDGETS` names each resource budget for its message, keyed by the `TREFFER_MAX_*` half of `TrefferErrorCode`. Add to both when you add a budget. The code is the contract; the message is not.
- `relocate` takes `span` as well as `offset`. `offset` shifts, for an embedder holding a verbatim slice; `span` replaces, for one whose text reached the pattern through a decode.
- `test/browser/harness.js` serves `lib/` **verbatim**. Bare specifiers are resolved by an import map the page declares, whose sha256 is what lets it run under a policy that forbids inline script; the harness reads that map out of the page rather than restating it. The hash makes the policy follow the page rather than stand apart from it: whatever the map declares is authorised by construction, which is the point — the two cannot disagree — but it is not an independent check on the map's contents. Never rewrite the source on the way out — this suite proves the published file runs under a strict CSP, and a rewritten copy would prove it of something nobody installs. A check in the harness fetches every served module back — dependencies included — and fails if any differs from its source on disk. Add a dependency to the map and to the route table, resolving it through `import.meta.resolve` rather than a hardcoded path.

## Conventions

Omakase: one obvious path over knobs. Test the guarantee a user relies on. Add complexity when concrete pressure shows up.

- oxfmt owns formatting on its defaults. `npm run fmt`.
- Comments only where the code cannot: safety rationale, non-obvious tricks.
- Bindings named for readers (`chars`, `pos`, `states`, `preds`). True loop counters (`j`) stay single letters. Rename with a scope-aware tool: a bare `s` also lives in strings and unrelated scopes, and `{ c }` shorthand is how `Matcher.c` became `Matcher.char`.
- Tests are `node:test` in `test/*.test.js` (`match`, `errors`, `safety`, `differential`), run against `lib/`. New syntax or a new guard belongs in the matching suite and in `fuzz/structured.fuzz.js`. Keep the fuzz differential oracle on short patterns and subjects so the native comparison engine cannot become a bottleneck. `.fuzz-corpus/` and generated artifacts stay uncommitted.
- ESM only. Two module formats would split the diagnostics WeakMap across a `require` / `import` seam.
- Conventional Commits, at most 80 characters.
- `lib/index.d.ts` is hand-written and pulled into `lib/index.js` with `@import`. Generating it would publish the internal AST and NFA types (`Node`, `State`, `Frag`, `Matcher`, `Nfa`). `checkJs` under `strict` keeps the pair honest, and the store carries the union: `diags` is a `Store<TrefferErrorCode>`, so a thrown code the declaration omits fails `npm run test:types` at the line that throws it. Do not drop that annotation — `store()` defaults `Code` to `string`, which compiles and checks nothing.
- Suppress `no-unused-expressions` on the expression that trips it (`cond || bad()`) with `// oxlint-disable-next-line` directly above it. oxfmt moves lines, so a trailing `-line` comment slips off its target. Leave the rule live in `.oxlintrc.json`. Type-aware suppressions use the `typescript/` prefix the diagnostic reports.
- `oxlint-tsgolint` is the binary that runs the type-aware rules; without it they drop silently.
- `test/types.check.ts` ends scopes with `void [...]` so type-only bindings stay live under `no-unused-vars`.
- Fallow defaults are the gate. Split and table-drive until shipped functions sit under them; leave `maxCognitive` and `maxCrap` alone. With no coverage file, estimated CRAP wants cyclomatic below 5. Duplicated helpers in `fuzz/` get exported. A second name in `ignoreDependencies` means a real graph edge is missing.
