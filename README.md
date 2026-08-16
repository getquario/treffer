# treffer

A tiny, bounded [RFC 9485 I-Regexp](https://www.rfc-editor.org/rfc/rfc9485.html) matcher for JavaScript. **~2KB min+gzip, zero runtime dependencies.**

[![NPM version](https://img.shields.io/npm/v/treffer.svg)](https://www.npmjs.com/package/treffer)
[![Build Status](https://github.com/getquario/treffer/actions/workflows/test.yml/badge.svg)](https://github.com/getquario/treffer/actions/workflows/test.yml)
[![NPM downloads](https://img.shields.io/npm/dm/treffer.svg)](https://www.npmjs.com/package/treffer)
[![Apache-2.0 license](https://img.shields.io/github/license/getquario/treffer.svg)](https://github.com/getquario/treffer/blob/main/LICENSE)

<a href="https://webstronauts.com?utm_source=github&utm_medium=readme&utm_campaign=treffer">
	<picture>
		<img src="https://webstronauts.com/images/sponsored-by.svg" alt="Sponsored by The Webstronauts" width="200" height="65">
	</picture>
</a>

_Treffer_ is Dutch for a hit or match. It parses I-Regexp patterns into Thompson NFAs and evaluates all active states together. Matching never backtracks, so patterns such as `(a+)+` have predictable runtime.

```js
import { compile, match, search } from "treffer";

const isbn = compile("[0-9]{13}");

isbn.match("9780131103627"); // true
isbn.match("ISBN 9780131103627"); // false
isbn.search("ISBN 9780131103627"); // true

match("a|b", "a"); // true
search("\\p{Lu}+", "price: EUR"); // true
```

## API

### `compile(pattern, options?)`

Checks and compiles a pattern once. The returned object has two methods:

- `match(subject)` tests the whole subject.
- `search(subject)` tests whether any substring matches.

```js
const words = compile("[\\p{L}-]+");

words.match("naïve"); // true
words.search("42 naïve"); // true
```

### `match(pattern, subject, options?)`

Compiles the pattern and tests the whole subject.

### `search(pattern, subject, options?)`

Compiles the pattern and tests every possible start position in one forward pass.

Use `compile()` when a pattern will run more than once.

## Syntax

Treffer is a checking RFC 9485 implementation. It supports:

- alternation, concatenation, and groups;
- `.`, character classes, ranges, and negated classes;
- Unicode general categories such as `\p{Lu}` and `\P{N}`;
- `*`, `+`, `?`, and `{m,n}` quantifiers.

JavaScript-only syntax such as `\d`, `\w`, lookarounds, backreferences, and lazy quantifiers is rejected. Use `[0-9]` instead of `\d`.

RFC 9485 treats `^` and `$` as ordinary characters. Pass `{ anchors: true }` to use them as subject anchors:

```js
const line = compile("^item-[0-9]+$", { anchors: true });
line.search("item-42"); // true
line.search("x item-42"); // false
```

## Errors and limits

Errors produced by Treffer keep their `SyntaxError`, `TypeError`, or `RangeError` class. Syntax and resource errors expose machine-readable properties:

- `code`: a stable category;
- `limit`: the fixed resource limit, for resource errors;
- `actual`: the observed value, when it can be determined without weakening early rejection.

The codes are `TREFFER_SYNTAX`, `TREFFER_MAX_PATTERN_SCALARS`, `TREFFER_MAX_GROUP_DEPTH`, `TREFFER_MAX_QUANTIFIER_DIGITS`, `TREFFER_MAX_REPETITIONS`, `TREFFER_MAX_NFA_STATES`, `TREFFER_MAX_SUBJECT_SCALARS`, and `TREFFER_MAX_TRANSITIONS`. API `TypeError`s have no code.

Errors thrown by caller-provided option accessors are host errors. Treffer passes them through unchanged and does not attach diagnostic fields.

Use `isDiagnostic(error)` when a host needs to distinguish those errors. It returns `true` only for errors created by the same Treffer module instance. Copying documented `code`, `limit`, and `actual` properties onto another error does not authenticate it. A diagnostic from another installed copy or module instance also returns `false`.

The fixed safety limits are:

- 4,096 Unicode scalar values per pattern;
- 64 nested groups;
- 4,096 NFA states;
- 1,024 repetitions in a range quantifier;
- six digits per quantifier bound;
- one million Unicode scalar values per subject;
- one million state transitions per match.

Runtime is bounded by the subject length times the number of active NFA states. Character-class checks count toward the transition budget. Treffer validates Unicode scalar values and rejects lone surrogates.

## Content Security Policy

Treffer parses patterns into data structures and closures. It generates no JavaScript source and works under a strict Content Security Policy.

## Environments

Node.js 22 and newer are supported through the ESM and CommonJS builds. Browser use is supported through a standards-based ESM bundler in environments supporting ES2024. Direct `<script>` globals and UMD builds are not provided.

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
