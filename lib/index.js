/**
 * Checking RFC 9485 I-Regexp compiler backed by a bounded Thompson NFA.
 */

/**
 * @import { Treffer, TrefferDiagnostic, TrefferErrorCode, TrefferOptions } from './index.js'
 * @import { Relocation, Store } from 'waarmerk'
 */
import { capped, mint, relocate as relocateFault, store } from "waarmerk";

/**
 * One compiled character predicate, carrying the literal it came from when it
 * matched a single character — class range endpoints need that literal.
 *
 * @internal
 * @typedef {{ test: (x: string) => boolean, char?: string }} Matcher
 */

/**
 * The tuple-encoded AST, discriminated on its first element: 0 empty,
 * 1 predicate, 2 anchor (`true` for `$`), 3 concatenation, 4 alternation,
 * 5 quantified, where the upper bound is -1 for unbounded.
 *
 * @internal
 * @typedef {[0]
 *   | [1, (x: string, spend: () => void) => boolean]
 *   | [2, boolean]
 *   | [3, Node[]]
 *   | [4, Node[]]
 *   | [5, Node, number, number]} Node
 */

/**
 * A partial NFA, `[entry, exits]`: the state it starts at, plus the dangling
 * `[state, slot]` exits still waiting to be patched to a successor.
 *
 * @internal
 * @typedef {[number, [number, number][]]} Frag
 */

/**
 * One NFA state, `[kind, x, y, value]`: kind 0 splits to `x`/`y`, 1 consumes a
 * character matching `value`, 2 asserts an anchor, 3 accepts.
 *
 * @internal
 * @typedef {[number, number, number, ((x: string, spend: () => void) => boolean) | boolean | undefined]} State
 */

/** @internal @typedef {{ states: State[], start: number, end: number }} Nfa */

const PROP = /^(?:L[lmotu]?|M[cen]?|N[dlo]?|P[cdefios]?|Z[lps]?|S[ckmo]?|C[cfno]?)$/;
const MAX = 4096,
  DEPTH = 64,
  REPEAT = 1024,
  STEPS = 1e6;

/**
 * @type {Store<TrefferErrorCode>}
 */
const diags = store("Treffer");

/** Test whether an error was created by this Treffer module instance. */
export let isDiagnostic = diags.isDiagnostic;

/**
 * Copy a diagnostic into an embedder's coordinates.
 *
 * @type {(diag: unknown, opts?: Relocation) => TrefferDiagnostic}
 */
export let relocate = (diag, opts) => {
  return /** @type {any} */ (relocateFault(diags, diag, opts));
};

/**
 * UTF-16 offset of code-point index `n` in the pattern being parsed, clamped
 * to the pattern: spans ship as string offsets, `chars` holds code points.
 * Error path only.
 *
 * @type {(n: number) => number}
 */
let at = (n) => chars.slice(0, Math.max(n, 0)).join("").length;

/**
 * Throw a syntax diagnostic, from code-point indices into `chars`. The span
 * defaults to the code point the cursor just consumed; callers that fault
 * before consuming, or on a whole construct, pass their own.
 *
 * `const`, not `let`: TypeScript only propagates a `never` return through
 * control-flow analysis when the callee binding cannot be reassigned.
 *
 * @type {(from?: number, to?: number) => never}
 */
const bad = (from = pos - 1, to = from + 1) => syntax(at(from), at(to));

/**
 * The one syntax fault this module throws, from UTF-16 offsets. `bad`
 * converts for it; the lone-surrogate check already holds them.
 *
 * @type {(start: number, end: number) => never}
 */
const syntax = (start, end) =>
  mint(diags, SyntaxError, "Invalid I-Regexp", { code: "TREFFER_SYNTAX", start, end });

/**
 * What each budget is called in the message it throws, parallel to the
 * `TREFFER_MAX_*` half of `TrefferErrorCode`.
 *
 * @type {Record<string, string>}
 */
const BUDGETS = {
  TREFFER_MAX_PATTERN_SCALARS: "pattern scalars",
  TREFFER_MAX_GROUP_DEPTH: "group depth",
  TREFFER_MAX_QUANTIFIER_DIGITS: "quantifier digits",
  TREFFER_MAX_REPETITIONS: "repetitions",
  TREFFER_MAX_NFA_STATES: "NFA states",
  TREFFER_MAX_SUBJECT_SCALARS: "subject scalars",
  TREFFER_MAX_TRANSITIONS: "transitions",
};

/**
 * The one fixed-limit guard, reporting the value that tripped it as `actual`.
 * The pattern-length pre-check calls `capped` itself: it rejects before a
 * scalar count exists.
 *
 * @type {(value: number, limit: number, code: TrefferErrorCode) => boolean}
 */
const within = (value, limit, code) =>
  value <= limit || capped(diags, BUDGETS[code], code, limit, value);

/**
 * Shared parser / NFA / matcher state, safe because compile and match are
 * synchronous.
 *
 * @type {string[]}
 */
let chars;
/** @type {number} */
let pos;
/** @type {number} */
let depth;
/** @type {boolean} */
let anchors;
/** @type {State[]} */
let states;
/** @type {number} */
let len;
/** @type {number} */
let steps;

/**
 * Count Unicode scalar values without allocating, rejecting lone surrogates.
 * High surrogates are `110110xxxxxxxx`, low are `110111xxxxxxxx`.
 *
 * `high` does both jobs: the unit at `j + high` must be a low surrogate
 * exactly when `high` says the scalar is a pair, and the cursor advances by
 * that same flag.
 *
 * @param {string} subject
 * @param {number} max
 * @param {(j: number) => void} invalid Called with the offset of the lone surrogate.
 * @param {TrefferErrorCode} code
 */
let scalarCount = (subject, max, invalid, code) => {
  let count = 0;
  for (let j = 0; j < subject.length;) {
    const high = (subject.charCodeAt(j) & 0xfc00) === 0xd800;
    // oxlint-disable-next-line no-unused-expressions
    ((subject.charCodeAt(j + +high) & 0xfc00) === 0xdc00) === high || invalid(j);
    j += 1 + +high;
    within(++count, max, code);
  }
};

/**
 * Consume the delimiter that closes a construct, faulting on whatever stood
 * where it belonged. The cursor moves past it either way, so `bad`'s default
 * span covers exactly the offender.
 *
 * @param {string} close
 */
let expect = (close) => chars[pos++] === close || bad();

/**
 * Read `\p{Name}` or `\P{Name}` from just past the escape letter, which
 * carries the class's polarity and goes into the compiled expression as-is.
 *
 * @param {string} letter Either `p` or `P`, as the pattern spelled it.
 * @returns {Matcher}
 */
let unicodeProp = (letter) => {
  const from = ++pos;
  let name = "";
  while (pos < chars.length && chars[pos] !== "}") name += chars[pos++];
  expect("}");
  // An unknown property is the name's fault, not the closing brace's, and the
  // cursor has already passed the brace by the time the check runs.
  // oxlint-disable-next-line no-unused-expressions
  PROP.test(name) || bad(from, pos - 1);
  const re = new RegExp("^\\" + letter + "{" + name + "}$", "u");
  return { test: (char) => re.test(char) };
};

/** @param {string} char */
let isPropEsc = (char) => (char === "p" || char === "P") && chars[pos] === "{";

/** @returns {Matcher} */
let esc = () => {
  // Past the end of the pattern this is `undefined`, which is in no whitelist,
  // so the check below faults on it — with the same span, since the cursor has
  // already stepped over the escape either way.
  const char = chars[pos++];
  if (isPropEsc(char)) return unicodeProp(char);
  // oxlint-disable-next-line no-unused-expressions
  "()*+-.?[\\]^nrt{|}".includes(char) || bad();
  // The two strings spell the three translating escapes in the same order.
  // Any other whitelisted letter misses the first, indexes past the second,
  // and so stands for itself.
  return solo("\n\r\t"["nrt".indexOf(char)] ?? char, "");
};

/**
 * One unescaped literal character, rejected when it is one of `banned` or when
 * the pattern ended instead. `banned` is the only difference between a class
 * member and an atom, so it arrives as data.
 *
 * @param {string | undefined} char
 * @param {string} banned
 * @returns {Matcher}
 */
let solo = (char, banned) => {
  // oxlint-disable-next-line no-unused-expressions
  (char != null && !banned.includes(char)) || bad();
  return { test: (x) => x === char, char };
};

/** @returns {Matcher} */
let one = () => (chars[pos] === "\\" ? (pos++, esc()) : solo(chars[pos++], "[]-"));

let rangeDash = () => chars[pos] === "-" && chars[pos + 1] !== "]";

/**
 * A range endpoint's code point. A statement-level `|| bad()` is not a
 * control-flow assertion, so the cast restates what `rangePred`'s guard
 * proved. The explicit `0` is `codePointAt`'s default, which its signature
 * requires.
 *
 * @param {Matcher} m
 * @returns {number}
 */
let endpoint = (m) => /** @type {number} */ (/** @type {string} */ (m.char).codePointAt(0));

/**
 * Both endpoints travel as a pair: one walk checks for the literals a range
 * needs and yields the bounds. `one()` runs first, so a fault spans the code
 * point the cursor last consumed.
 *
 * @param {((x: string) => boolean)[]} preds
 * @param {Matcher} first
 */
let rangePred = (preds, first) => {
  pos++;
  const pair = [first, one()];
  // oxlint-disable-next-line no-unused-expressions
  (pair.every((m) => m.char != null) && endpoint(pair[0]) <= endpoint(pair[1])) || bad();
  const [low, high] = pair.map(endpoint);
  preds.push((x) => {
    const n = /** @type {number} */ (x.codePointAt(0));
    return n >= low && n <= high;
  });
};

/**
 * @param {((x: string) => boolean)[]} preds
 */
let classItem = (preds) => {
  // A `-` right before `]` is a literal, not the start of a range.
  if (chars[pos] === "-" && chars[pos + 1] === "]") return (preds.push((x) => x === "-"), pos++);
  const first = one();
  if (rangeDash()) rangePred(preds, first);
  else preds.push(first.test);
};

/**
 * An empty class is the fault of the `]` that closes it, and the cursor has
 * not passed that `]` yet — so the empty case faults without consuming it.
 *
 * @param {((x: string) => boolean)[]} preds
 */
let closeClass = (preds) => (preds.length ? expect("]") : bad());

/** @returns {Node} */
let cls = () => {
  const neg = chars[pos] === "^",
    preds = /** @type {((x: string) => boolean)[]} */ ([]);
  // Stepping by `+neg` consumes the `^` only when there was one, without
  // spending a branch this function cannot afford.
  pos += +neg;
  // A leading `-` is a literal too.
  // oxlint-disable-next-line no-unused-expressions
  if (chars[pos] === "-") (preds.push((x) => x === "-"), pos++);
  while (pos < chars.length && chars[pos] !== "]") classItem(preds);
  closeClass(preds);
  return [1, (char, spend) => neg !== preds.some((p) => (spend(), p(char)))];
};

/** @returns {number} */
let number = () => {
  let value = 0,
    digits = 0;
  // Past the end of the pattern `chars[pos]` is `undefined`, which compares as
  // a number against `"0"` and so is never a digit — the loop needs no separate
  // bounds test.
  while (chars[pos] >= "0" && chars[pos] <= "9") {
    within(++digits, 6, "TREFFER_MAX_QUANTIFIER_DIGITS");
    value = value * 10 + +chars[pos++];
    within(value, REPEAT, "TREFFER_MAX_REPETITIONS");
  }
  // oxlint-disable-next-line no-unused-expressions
  digits || bad(pos);
  return value;
};

/** @type {() => Node} */
let alt;

/** @param {string | undefined} char */
let isAnchor = (char) => anchors && (char === "^" || char === "$");

/** @param {string | undefined} char @returns {Node} */
let atomRest = (char) => {
  if (char === "\\") return [1, esc().test];
  if (char === ".") return [1, (/** @type {string} */ x) => x !== "\n" && x !== "\r"];
  if (isAnchor(char)) return [2, char === "$"];
  return [1, solo(char, "()[]|*+?{}").test];
};

/** @returns {Node} */
let atom = () => {
  const char = chars[pos++];
  if (char !== "(") return char === "[" ? cls() : atomRest(char);
  within(++depth, DEPTH, "TREFFER_MAX_GROUP_DEPTH");
  const n = alt();
  expect(")");
  depth--;
  return n;
};

/** @param {number} lo @returns {number} */
let commaBound = (lo) => {
  if (chars[pos] !== ",") return lo;
  pos++;
  return chars[pos] === "}" ? -1 : number();
};

/** @returns {[number, number]} */
let brace = () => {
  const from = pos++;
  const lo = number();
  const hi = commaBound(lo);
  expect("}");
  // An impossible bound is not one bad character; the whole quantifier is
  // wrong, so the span runs from the opening brace to past the closing one.
  // oxlint-disable-next-line no-unused-expressions
  hi < 0 || lo <= hi || bad(from, pos);
  return [lo, hi];
};

/**
 * An atom and the quantifier following it, if any. Only `+` has a lower bound
 * and only `?` an upper one, so the three one-character quantifiers are read
 * off the character arithmetically. `{` reads its own bounds.
 *
 * @returns {Node}
 */
let piece = () => {
  const a = atom(),
    char = chars[pos],
    q = "*+?".includes(char);
  if (q) pos++;
  else if (char !== "{") return a;
  const [lo, hi] = q ? [+(char === "+"), 2 * +(char === "?") - 1] : brace();
  return [5, a, lo, hi];
};

/**
 * Both levels of the grammar are the same accumulation: collect while `step`
 * holds, then wrap in `kind` — but only past one item, since a one-element
 * list compiles to whatever its only child does. Nothing at all is `[0]`.
 *
 * @param {3 | 4} kind
 * @param {Node[]} v The items already collected, which for an alternation is
 *   the branch that had to be read before the separator could be seen.
 * @param {() => Node | false} step Reads the next item, or reports that the
 *   cursor is no longer on one.
 * @returns {Node}
 */
let list = (kind, v, step) => {
  for (let n; (n = step());) v.push(n);
  return v.length > 1 ? [kind, v] : (v[0] ?? [0]);
};

/** @returns {Node} */
let branch = () =>
  list(3, [], () => pos < chars.length && chars[pos] !== "|" && chars[pos] !== ")" && piece());

alt = () => list(4, [branch()], () => chars[pos] === "|" && (pos++, branch()));

/**
 * @param {string} src
 * @param {boolean} wantAnchors
 * @returns {Node}
 */
let parse = (src, wantAnchors) => {
  // oxlint-disable-next-line no-unused-expressions
  src.length <= MAX * 2 ||
    capped(diags, BUDGETS.TREFFER_MAX_PATTERN_SCALARS, "TREFFER_MAX_PATTERN_SCALARS", MAX);
  // A lone surrogate here is found before `chars` exists, and `j` is already a
  // string offset, so it spans itself without the conversion `bad` would apply.
  scalarCount(src, MAX, (j) => syntax(j, j + 1), "TREFFER_MAX_PATTERN_SCALARS");
  [chars, pos, depth, anchors] = [Array.from(src), 0, 0, wantAnchors];
  const out = alt();
  // oxlint-disable-next-line no-unused-expressions
  pos === chars.length || bad(pos);
  return out;
};

/**
 * @param {number} t
 * @param {number} [x]
 * @param {number} [y]
 * @param {State[3]} [v]
 * @returns {number}
 */
let addState = (t, x = -1, y = -1, v) => {
  within(states.length + 1, MAX, "TREFFER_MAX_NFA_STATES");
  return states.push([t, x, y, v]) - 1;
};

/** @param {[number, number][]} o @param {number} x */
let patch = (o, x) => o.forEach(([j, k]) => (states[j][k] = x));

/**
 * @param {number} t
 * @param {State[3]} [v]
 * @returns {Frag}
 */
let leaf = (t, v) => {
  const j = addState(t, -1, -1, v);
  return [j, [[j, 1]]];
};

/** @param {Frag} a @param {Frag} b @returns {Frag} */
let cat = (a, b) => (patch(a[1], b[0]), [a[0], b[1]]);

/**
 * Grow `a` by one step per index in `[from, to)`, the accumulation every
 * fragment the builder assembles shares.
 *
 * @param {Frag} a
 * @param {number} from
 * @param {number} to
 * @param {(a: Frag, k: number) => Frag} step
 * @returns {Frag}
 */
let repeat = (a, from, to, step) => {
  for (let k = from; k < to; k++) a = step(a, k);
  return a;
};

/**
 * Compile a node list and combine the fragments left to right. Concatenation
 * and alternation differ only in how two neighbours join.
 *
 * @param {Node[]} list
 * @param {(a: Frag, b: Frag) => Frag} join
 * @returns {Frag}
 */
let fold = (list, join) =>
  repeat(visit(list[0]), 1, list.length, (a, k) => join(a, visit(list[k])));

/** @type {(n: Node) => Frag} */
let visit;

/**
 * One more optional copy of `body` after `a`: a split state in front of the
 * body, with `a`'s exits routed into it. The split's skip exit is appended
 * last, so a caller wanting the loop back edge instead can pop it.
 *
 * @param {Frag} a
 * @param {Node} body
 * @returns {Frag}
 */
let optional = (a, body) => {
  const b = visit(body),
    j = addState(0, b[0]);
  return (patch(a[1], j), [a[0], b[1].concat([[j, 2]])]);
};

/** @param {any} n @returns {Frag} */
let quantified = (n) => {
  const a = repeat(n[2] ? visit(n[1]) : leaf(0), 1, n[2], (f) => cat(f, visit(n[1])));
  if (n[3] >= 0) return repeat(a, n[2], n[3], (f) => optional(f, n[1]));
  // Unbounded: one more optional copy, whose skip exit becomes the loop's back
  // edge, so that copy is the one the machine repeats.
  const f = optional(a, n[1]),
    j = /** @type {[number, number]} */ (f[1].pop())[0];
  return (patch(f[1], j), [f[0], [[j, 2]]]);
};

// Kinds 0, 1 and 2 are one state carrying the node's own value; an empty node
// has no second element, which is what the cast buys.
visit = (n) =>
  n[0] < 3
    ? leaf(n[0], /** @type {any} */ (n)[1])
    : n[0] === 3
      ? fold(/** @type {any} */ (n)[1], cat)
      : n[0] === 4
        ? fold(/** @type {any} */ (n)[1], (a, b) => [addState(0, a[0], b[0]), a[1].concat(b[1])])
        : quantified(n);

const spend = () => within(++steps, STEPS, "TREFFER_MAX_TRANSITIONS");

/**
 * Take one state out of the closure walk: a split queues both successors, an
 * anchor queues its successor only where it holds, and a consuming state
 * joins the active set.
 *
 * @param {Set<number>} set
 * @param {number} j
 * @param {number} at
 * @param {number[]} todo
 */
let enqueue = (set, j, at, todo) => {
  const state = states[j];
  if (state[0] === 0) todo.push(state[1], state[2]);
  // A kind-2 state carries its own polarity in slot 3: `$` holds at `len`, `^`
  // only at 0, which is `len` times that flag either way.
  // oxlint-disable-next-line no-unused-expressions
  else if (state[0] === 2) at === len * +(/** @type {boolean} */ (state[3])) && todo.push(state[1]);
  else set.add(j);
};

/**
 * @param {Set<number>} set
 * @param {number} root
 * @param {number} at
 */
let add = (set, root, at) => {
  const todo = [root],
    seen = /** @type {Set<number>} */ (new Set());
  while (todo.length) {
    // The loop guard proves the stack is non-empty.
    const j = /** @type {number} */ (todo.pop());
    if (j < 0 || seen.has(j)) continue;
    seen.add(j);
    spend();
    enqueue(set, j, at, todo);
  }
};

/**
 * @param {Set<number>} cur
 * @param {Nfa} nfa
 * @param {boolean} full
 * @param {number} at
 */
let startStep = (cur, nfa, full, at) => {
  // oxlint-disable-next-line no-unused-expressions
  full || add(cur, nfa.start, at);
  return cur.has(nfa.end) && (!full || at === len);
};

/**
 * @param {string} str
 * @param {Set<number>} cur
 * @param {Nfa} nfa
 * @param {boolean} full
 */
let scan = (str, cur, nfa, full) => {
  let at = 0;
  for (;;) {
    if (startStep(cur, nfa, full, at)) return true;
    if (at === len) return false;
    // `at === len` broke out above, so there is always a code point here, and
    // its UTF-16 width is the width of the string it round-trips through.
    const char = String.fromCodePoint(/** @type {number} */ (str.codePointAt(at))),
      next = /** @type {Set<number>} */ (new Set());
    cur.forEach((j) => {
      spend();
      const state = states[j];
      // Kind 1 is the only state carrying a predicate in slot 3; `State` is a
      // flat tuple rather than a discriminated union, so restate that here.
      if (
        state[0] === 1 &&
        /** @type {(x: string, spend: () => void) => boolean} */ (state[3])(char, spend)
      )
        add(next, state[1], at + char.length);
    });
    cur = next;
    at += char.length;
  }
};

/**
 * @param {Nfa} nfa
 * @param {string} str
 * @param {boolean} full
 * @returns {boolean}
 */
let run = (nfa, str, full) => {
  // oxlint-disable-next-line no-unused-expressions
  typeof str === "string" || mint(diags, TypeError, "Subject must be a string");
  scalarCount(
    str,
    STEPS,
    () => mint(diags, TypeError, "Subject must contain Unicode scalar values"),
    "TREFFER_MAX_SUBJECT_SCALARS",
  );
  [states, len, steps] = [nfa.states, str.length, 0];
  const cur = /** @type {Set<number>} */ (new Set());
  if (full) add(cur, nfa.start, 0);
  return scan(str, cur, nfa, full);
};

/**
 * @param {TrefferOptions} [options]
 * @returns {boolean}
 */
let anchorsOption = (options) => {
  const value = options?.anchors ?? false;
  // oxlint-disable-next-line no-unused-expressions
  typeof value === "boolean" || mint(diags, TypeError, "anchors must be a boolean");
  return value;
};

/**
 * Compile and validate an RFC 9485 I-Regexp.
 *
 * @param {string} pattern
 * @param {TrefferOptions} [options]
 * @returns {Treffer}
 */
export let compile = (pattern, options) => {
  // oxlint-disable-next-line no-unused-expressions
  typeof pattern === "string" || mint(diags, TypeError, "Pattern must be a string");
  if (options != null && typeof options !== "object")
    mint(diags, TypeError, "Options must be an object");
  const ast = parse(pattern, anchorsOption(options));
  states = /** @type {State[]} */ ([]);
  const f = visit(ast),
    end = addState(3);
  patch(f[1], end);
  const nfa = /** @type {Nfa} */ ({ states, start: f[0], end });
  return Object.freeze({
    /** @param {string} subject */
    match: (subject) => run(nfa, subject, true),
    /** @param {string} subject */
    search: (subject) => run(nfa, subject, false),
  });
};

/**
 * Compile a pattern and test it against the whole subject.
 *
 * @param {string} pattern
 * @param {string} subject
 * @param {TrefferOptions} [options]
 * @returns {boolean}
 */
export let match = (pattern, subject, options) => compile(pattern, options).match(subject);
/**
 * Compile a pattern and test it against any substring of the subject.
 *
 * @param {string} pattern
 * @param {string} subject
 * @param {TrefferOptions} [options]
 * @returns {boolean}
 */
export let search = (pattern, subject, options) => compile(pattern, options).search(subject);
