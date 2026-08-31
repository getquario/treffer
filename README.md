# treffer

A tiny, bounded [RFC 9485 I-Regexp](https://www.rfc-editor.org/rfc/rfc9485.html) matcher for JavaScript. **~2KB min+gzip, one tiny runtime dependency.**

[![NPM version](https://img.shields.io/npm/v/treffer.svg)](https://www.npmjs.com/package/treffer)
[![Build Status](https://github.com/getquario/treffer/actions/workflows/test.yml/badge.svg)](https://github.com/getquario/treffer/actions/workflows/test.yml)
[![NPM downloads](https://img.shields.io/npm/dm/treffer.svg)](https://www.npmjs.com/package/treffer)
[![Apache-2.0 license](https://img.shields.io/github/license/getquario/treffer.svg)](https://github.com/getquario/treffer/blob/main/LICENSE)

<a href="https://webstronauts.com?utm_source=github&utm_medium=readme&utm_campaign=treffer">
	<picture>
		<img src="https://webstronauts.com/images/sponsored-by.svg" alt="Sponsored by The Webstronauts" width="200" height="65">
	</picture>
</a>

_Treffer_ is Dutch for a hit or a match. It runs regular expressions that come from somewhere you don't control — a user's search filter, a rule in a config file, a `pattern` in a schema — without the two things that make that dangerous with `RegExp`: catastrophic backtracking, and a syntax that means different things in different languages.

Patterns compile to a Thompson NFA and every active state advances together. There is no backtracking, so `(a+)+b` against a string of 28 `a`s finishes in a single linear pass, where a backtracking engine explores millions of paths before giving up. Every stage is bounded besides — pattern size, nesting, states, and matching work all have [fixed limits](#limits) that turn a hostile pattern into a thrown error rather than a wedged process.

The syntax is [RFC 9485 I-Regexp](https://www.rfc-editor.org/rfc/rfc9485.html), the interoperable subset that JSONPath and JSON Schema build on. It is deliberately smaller than JavaScript's: no `\d`, no lookarounds, no backreferences, no lazy quantifiers. What you gain is that a pattern means the same thing here, in a Python validator, and in a Go service.

## Contents

- [Install](#install)
- [Usage](#usage)
- [Is treffer the right tool?](#is-treffer-the-right-tool)
- [Related packages](#related-packages)
- [Syntax](#syntax)
- [API](#api)
- [Limits](#limits)
- [Content Security Policy](#content-security-policy)
- [Environments](#environments)
- [Embedding treffer](#embedding-treffer)
- [Contributing](#contributing)
- [License](#license)

## Install

```bash
npm install treffer
```

Node.js 22 or newer, ESM only. TypeScript declarations ship with the package; nothing extra to install.

## Usage

```js
import { compile, match, search } from "treffer";

// Compile once, test many times:
const isbn = compile("[0-9]{13}");

isbn.match("9780131103627"); // true  — the whole subject
isbn.match("ISBN 9780131103627"); // false — match() is anchored
isbn.search("ISBN 9780131103627"); // true  — search() looks for a substring

// Or one-shot:
match("a|b", "a"); // true
search("\\p{Lu}+", "price: EUR"); // true
```

Both answer a yes-or-no question. There is no match object, no capture groups, and no replace — see below.

## Is treffer the right tool?

treffer answers one question: does this pattern match this string? It returns a boolean, and it accepts only patterns that RFC 9485 allows.

**It fits when:**

- Patterns arrive from outside your code — typed by a user, stored in a config file or database, carried in a JSON Schema or JSONPath filter — so a pathological one is a matter of when, not if.
- You need a pattern to mean the same thing across languages. RFC 9485 exists because `\d`, `.`, and `\b` don't agree between engines.
- You want bounded work per call, with a limit you can point at, rather than a timeout you hope fires.
- Bundle size is a real constraint.

**Look elsewhere when:**

- You need what the match _was_, not whether it matched. There are no capture groups, no match positions, no `exec`, and no `replace`. This is a predicate.
- You need JavaScript regex syntax. `\d`, `\w`, `\s`, `\b`, lookarounds, backreferences, and lazy quantifiers are all rejected, and rewriting an existing pattern is on you.
- Your patterns are literals you wrote yourself. Nobody can ReDoS you with a pattern you control, and `RegExp` is built in, faster on ordinary input, and does far more.
- You need case-insensitive or multiline flags. RFC 9485 has no flags; the only knob here is [`anchors`](#anchors).
- You need CommonJS, or Node older than 22. See [Environments](#environments).

## Related packages

- **[padvinder](https://github.com/getquario/padvinder)** — an RFC 9535 JSONPath engine, and treffer's main consumer: JSONPath's `match()` and `search()` filter functions are defined in terms of I-Regexp, which is most of why this package exists. If you're reaching for treffer to filter a JSON document, padvinder may be the layer you actually want.
- **[xprsn](https://github.com/getquario/xprsn)** and **[sjabloon](https://github.com/getquario/sjabloon)** — an expression language and a template engine from the same family, both CSP-safe and dependency-light, if the untrusted input you're evaluating is a rule or a template rather than a pattern.

## Syntax

| Category      | Syntax                                               | Notes                                                 |
| ------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Alternation   | `a\|b`                                               | Either branch; the answer is a boolean                |
| Grouping      | `(ab)+`                                              | Grouping only — nothing is captured                   |
| Any character | `.`                                                  | Any scalar value except U+000A and U+000D             |
| Classes       | `[abc]`, `[a-z]`, `[^0-9]`                           | Ranges and negation                                   |
| Unicode       | `\p{Lu}`, `\P{N}`                                    | General categories only — no script names             |
| Quantifiers   | `a*`, `a+`, `a?`, `a{3}`, `a{2,5}`, `a{2,}`          | Greedy only; `{m,n}` bounded by the [limits](#limits) |
| Escapes       | `\(`, `\)`, `\[`, `\]`, `\.`, `\*`, `\+`, `\?`, `\\` | Plus `\n`, `\r`, `\t`; the I-Regexp set only          |

Rejected, with a `TREFFER_SYNTAX` error naming the offending characters: `\d`, `\w`, `\s`, `\b` and their negations (write `[0-9]` instead of `\d`), script names like `\p{Greek}`, lookahead and lookbehind, backreferences, lazy quantifiers (`a+?`), named groups, and flags.

The rejection is the feature. A pattern that compiles here is a pattern every conforming I-Regexp implementation reads the same way.

### Anchors

RFC 9485 treats `^` and `$` as ordinary characters, so `compile("^a")` matches a literal caret. Use `match()` when you want the whole subject and `search()` when you want a substring.

If you're accepting patterns from people who expect anchors to work, `{ anchors: true }` turns them into subject anchors. It is a compatibility extension, not part of the RFC, so a pattern written for it is no longer portable:

```js
const line = compile("^item-[0-9]+$", { anchors: true });

line.search("item-42"); // true
line.search("x item-42"); // false
```

## API

### `compile(pattern, options?)`

Checks and compiles a pattern once, returning an object with two methods:

- `match(subject)` tests the whole subject;
- `search(subject)` tests whether any substring matches, in one forward pass over every start position.

```js
const words = compile("[\\p{L}-]+");

words.match("naïve"); // true
words.search("42 naïve"); // true
```

Invalid syntax and over-budget patterns throw here, so a compiled pattern is one that will not surprise you later. Use `compile` whenever a pattern runs more than once.

### `match(pattern, subject, options?)` and `search(pattern, subject, options?)`

Compile and test in one call. Both compile every time, so prefer `compile` in a loop.

### Errors

Errors keep their native `SyntaxError`, `TypeError`, or `RangeError` class. Syntax and resource errors carry machine-readable fields:

- `code`: a stable category;
- `start` / `end`: zero-based, exclusive offsets into the pattern, on syntax errors;
- `limit` / `actual`: the fixed budget and the observed value, on resource errors.

Spans are UTF-16 offsets into the pattern you passed, so `pattern.slice(start, end)` is the offending text:

```js
import { compile, isDiagnostic } from "treffer";

try {
  compile("a{2,1}");
} catch (error) {
  if (!isDiagnostic(error)) throw error;
  error.code; // => 'TREFFER_SYNTAX'
  "a{2,1}".slice(error.start, error.end); // => '{2,1}'  — the whole impossible bound
}
```

A span covers the construct that made the pattern invalid: the whole quantifier for an impossible bound, the property name for an unknown `\p{...}`, and an empty span at the end when the pattern stops early. A resource limit is not a position, so those diagnostics have no span and carry `limit` and `actual` instead, with a message naming the budget — `group depth limit of 64 exceeded`. Branch on `code`; the message is for a human reading a stack trace.

The codes are `TREFFER_SYNTAX`, `TREFFER_MAX_PATTERN_SCALARS`, `TREFFER_MAX_GROUP_DEPTH`, `TREFFER_MAX_QUANTIFIER_DIGITS`, `TREFFER_MAX_REPETITIONS`, `TREFFER_MAX_NFA_STATES`, `TREFFER_MAX_SUBJECT_SCALARS`, and `TREFFER_MAX_TRANSITIONS`. `TypeError`s from misusing the API itself have no code.

Errors thrown by caller-provided option accessors are host errors. treffer passes them through unchanged and does not attach diagnostic fields. `isDiagnostic(error)` is how you tell the two apart; it authenticates by identity rather than by shape, which matters if you embed treffer — see [EMBEDDING.md](EMBEDDING.md#diagnostic-identity), which also covers `relocate` and when to fold a resource error into a plain `false`.

## Limits

Every budget is fixed. Exceeding one throws a `RangeError` with the matching code, so a hostile pattern fails loudly instead of running long:

| Budget                            | Limit     |
| --------------------------------- | --------- |
| Unicode scalar values per pattern | 4,096     |
| Nested groups                     | 64        |
| NFA states                        | 4,096     |
| Repetitions in a range quantifier | 1,024     |
| Digits per quantifier bound       | 6         |
| Unicode scalar values per subject | 1,000,000 |
| State transitions per match       | 1,000,000 |

Runtime is bounded by the subject length times the number of active NFA states; character-class checks count toward the transition budget. treffer validates Unicode scalar values and rejects lone surrogates in both patterns and subjects.

These bound the work inside the matcher, not the wall clock of your application. [SECURITY.md](SECURITY.md) covers what that does and doesn't buy you, and the process for reporting a vulnerability.

## Content Security Policy

treffer parses patterns into data structures and closures. It generates no JavaScript source, so it needs no `unsafe-eval` and works under a strict Content Security Policy. The test suite runs under `node --disallow-code-generation-from-strings`, which throws on any string-to-code construct the same way a strict CSP does.

## Environments

Node.js 22 and newer, ESM only. Browser use is supported through a standards-based ESM bundler in environments supporting ES2024. Direct `<script>` globals, UMD, and CommonJS builds are not provided.

Shipping CommonJS alongside ESM would put two copies of the core in any process that mixed `require` and `import`. Each copy would have its own diagnostic identity, so `isDiagnostic` would return `false` across the seam.

TypeScript declarations are hand-written and ship in the package; `npm run check` runs `attw` against them.

## Embedding treffer

If you compile patterns out of a larger document — a filter selector in a JSONPath query, a `pattern` keyword in a JSON Schema — [EMBEDDING.md](EMBEDDING.md) covers the surface built for that: diagnostic identity, relocating a fault into your own coordinates, the `span` form for patterns that reached you through a decode, and when a resource error should become a plain `false`.

## Contributing

```bash
git clone https://github.com/getquario/treffer.git
cd treffer
npm install
git config core.hooksPath .githooks   # enable the commit-msg hook
npm run check
```

`npm run check` is the local gate: formatting, lint, dead-code and dependency checks, the size budget, the unit and type suites, the fuzz regression corpus, and the browser CSP run. It is the same gate CI runs, so a green `check` locally means a green pull request.

Conventions for this repo — the parser, the semantics that look like bugs if you tidy them, and the commit format — live in [AGENTS.md](AGENTS.md).

## License

Copyright 2026 Robin van der Vleuten

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
