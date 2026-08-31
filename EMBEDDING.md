# Embedding treffer

For hosts that compile patterns out of a larger document — a filter selector in a
JSONPath query, a `pattern` keyword in a JSON Schema, a validation rule in a form
definition — and that need to report a fault in their own coordinates rather than
the pattern's.

None of this is needed to match patterns. [README.md](README.md) covers the
ordinary surface: `compile`, `match`, `search`, the syntax, the error codes, and
the limits.

- [Diagnostic identity](#diagnostic-identity)
- [`relocate(diagnostic, options)`](#relocatediagnostic-options)
  - [`offset`, for a verbatim slice](#offset-for-a-verbatim-slice)
  - [`span`, for text that was decoded](#span-for-text-that-was-decoded)
- [Resource errors as "no match"](#resource-errors-as-no-match)

## Diagnostic identity

`isDiagnostic(error)` returns `true` only for errors created by the same treffer
module instance. It is an identity check, not a shape check: copying the
documented `code`, `start`, `end`, `limit`, and `actual` properties onto another
error does not authenticate it, and a diagnostic from another installed copy
returns `false`.

That matters because a host has to tell three kinds of failure apart:

1. treffer's own faults, which carry a span in the pattern or a resource budget;
2. errors thrown by _your_ option accessors, which treffer passes through
   unchanged and does not annotate;
3. everything else.

Only the first can be pointed at a source location.

The identity machinery and the `Diagnostic` / `Relocation` types come from
[waarmerk](https://www.npmjs.com/package/waarmerk), treffer's one runtime
dependency. `TrefferDiagnostic` is waarmerk's `Diagnostic` narrowed to
treffer's own code union, so a host that already handles waarmerk diagnostics
handles these.

## `relocate(diagnostic, options)`

`relocate(diagnostic, { prefix, offset })` — or `{ prefix, span }` — returns the
copy to re-throw. The copy keeps the original's class, prepends `prefix` to the
message verbatim, moves the span when there is one, and carries every other field
across. It is registered exactly as the original was, so it passes
`isDiagnostic`. The original is left untouched. Passing anything but a treffer
diagnostic throws a `TypeError`.

Relocation lives here rather than in the embedder because authentication is by
identity: a copy an embedder builds itself cannot be authenticated, and a field
added to a diagnostic here would be a field the embedder's copy silently drops.

Neither option adds a span to a diagnostic that had none — a resource error
(`TREFFER_MAX_NFA_STATES` and its siblings) is a budget, not a position, and
stays spanless through a relocation.

### `offset`, for a verbatim slice

`offset` shifts the span. It is right whenever the pattern was a verbatim slice
of your text, so every offset in the pattern is that many characters further
along in the document:

```js
import { compile, isDiagnostic, relocate } from "treffer";

try {
  compile(pattern);
} catch (error) {
  if (!isDiagnostic(error)) throw error;
  // where the pattern literal starts inside the surrounding query
  throw relocate(error, { prefix: "$.a[?match(@.b, ...)]: ", offset: 16 });
}
```

### `span`, for text that was decoded

`offset` is wrong when your text was decoded before the pattern reached treffer —
a pattern read out of a JSON string literal, where `\\d` is three characters in
the document standing for two in the pattern, and every offset after it slides.
No single shift can land on the offending character.

Name the region the pattern came from instead:

```js
// The pattern reached treffer after JSON unescaping, so no shift can reach the
// offending character. Point at the literal that carried it.
throw relocate(error, { prefix: "$.a[?match(@.b, ...)]: ", span: [16, 24] });
```

`span` replaces the span outright, and wins when both are given. Pointing at the
whole literal is less precise than a character, and it is the most precise thing
that is still true.

## Resource errors as "no match"

A rejected pattern and an over-budget match both throw. Whether that should
surface to your user as an error or fold into a `false` is the host's call, and
RFC 9535 (JSONPath) makes it a `false` — a filter that cannot be evaluated
selects nothing.

Branch on `code`, not on the message:

```js
const RESOURCE = /^TREFFER_MAX_/;

const test = (pattern, subject) => {
  try {
    return match(pattern, subject);
  } catch (error) {
    if (isDiagnostic(error) && RESOURCE.test(error.code)) return false;
    throw error; // a syntax fault is the author's mistake; let it out
  }
};
```

The distinction worth keeping is that a resource error says the pattern was
_valid but too expensive_, while `TREFFER_SYNTAX` says the author wrote something
treffer will never accept. The first is a runtime condition; the second belongs
in front of whoever wrote the pattern.
