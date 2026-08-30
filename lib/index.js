/**
 * Checking RFC 9485 I-Regexp compiler backed by a bounded Thompson NFA.
 */

/**
 * The public types are declared once, in the hand-written `index.d.ts` beside
 * this file, and pulled in here — so a signature that drifts from what ships
 * fails to compile. Only the internal types below are defined locally.
 *
 * @import { Treffer, TrefferDiagnostic, TrefferErrorCode, TrefferOptions } from './index.js'
 */

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
 * A partial NFA: its entry state, plus the dangling `[state, slot]` exits still
 * waiting to be patched to a successor.
 *
 * @internal
 * @typedef {{ s: number, o: [number, number][] }} Frag
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

/** @type {Record<string, string>} */
const ESC = { n: "\n", r: "\r", t: "\t" };

let diags = new WeakSet(),
  mark = diags.add.bind(diags);
/**
 * Test whether an error was created by this Treffer module instance.
 *
 * The bound `WeakSet.has` is a `(value: WeakKey) => boolean`, which cannot be
 * assigned to a type-predicate signature; the cast is what publishes the
 * narrowing consumers rely on.
 *
 * @type {(error: unknown) => error is TrefferDiagnostic}
 */
export let isDiagnostic = /** @type {any} */ (diags.has.bind(diags));

/**
 * Intrinsics captured at module load, exactly as `mark` is: a copy is
 * built from a fixed table of error classes rather than through the original's
 * `constructor`, so replacing a prototype's `constructor` cannot make
 * `relocate` mint an authenticated value that is not an Error.
 */
const DESCS = Object.getOwnPropertyDescriptors,
  DEFINE = Object.defineProperties,
  PROTO = Object.getPrototypeOf,
  SYNTAX = SyntaxError.prototype,
  TYPE = TypeError.prototype,
  RANGE = RangeError.prototype;
/** @type {(p: any) => (msg: string) => Error} */
const kindOf = (p) =>
  p === SYNTAX ? SyntaxError : p === TYPE ? TypeError : p === RANGE ? RangeError : Error;
/**
 * Copy a diagnostic into an embedder's coordinates.
 *
 * Relocation lives here, beside the authentication it has to satisfy: the copy
 * is registered in the same WeakSet as the original, so it passes
 * `isDiagnostic`. The original is never mutated, and every own field comes
 * across by descriptor, so a field added here is never a field an embedder
 * forgets. A resource-limit diagnostic has no span to shift and keeps none.
 *
 * @param {unknown} diag A diagnostic from this module instance.
 * @param {{ prefix?: string, offset?: number }} [opts] `prefix` is prepended to
 *   the message verbatim; `offset` shifts `start` and `end` when there is a span.
 * @returns {TrefferDiagnostic} The relocated copy.
 * @throws {TypeError} When `diag` is not a diagnostic from this instance.
 */
export let relocate = (diag, { prefix = "", offset = 0 } = {}) => {
  if (!isDiagnostic(diag)) throw TypeError("Not a Treffer diagnostic");
  let d = /** @type {any} */ (diag),
    props = DESCS(d),
    copy = kindOf(PROTO(d))(prefix + d.message);
  delete props.message;
  delete props.stack;
  if (props.start) {
    props.start.value += offset;
    props.end.value += offset;
  }
  DEFINE(copy, props);
  return (mark(copy), /** @type {TrefferDiagnostic} */ (copy));
};
/**
 * `code` is typed to the published union, so a code this module throws but the
 * `TrefferErrorCode` typedef does not declare fails to compile rather than
 * shipping.
 *
 * @param {(msg: string) => Error} Type
 * @param {string} msg
 * @param {TrefferErrorCode} [code]
 * @param {Record<string, number>} [own] The metadata this kind of fault carries:
 *   `limit`/`actual` for a resource cap, `start`/`end` for a syntax fault.
 * @returns {never}
 */
const fault = (Type, msg, code, own) => {
  const e = /** @type {any} */ (Type(msg));
  if (code) e.code = code;
  if (own) Object.assign(e, own);
  throw (mark(e), e);
};

/**
 * UTF-16 offset of code-point index `n` in the pattern being parsed, clamped
 * to the pattern. Spans are string offsets, not code-point indices, so an
 * embedder can slice the pattern it passed in; `chars` is code points, so the
 * conversion is a join. Error path only.
 *
 * @type {(n: number) => number}
 */
let at = (n) => chars.slice(0, Math.max(n, 0)).join("").length;

/**
 * Throw a syntax diagnostic spanning `[start, end)` in UTF-16 offsets — the
 * coordinates a span ships in. `bad` is the code-point-index door to the same
 * fault; the two differ by `at`, and mixing them up is only visible on a
 * pattern with an astral character.
 *
 * `const`, not `let`, here and in `bad`: TypeScript only propagates a `never`
 * return through control-flow analysis when the callee binding cannot be
 * reassigned.
 *
 * @type {(start: number, end: number) => never}
 */
const badAt = (start, end) =>
  fault(SyntaxError, "Invalid I-Regexp", "TREFFER_SYNTAX", { start, end });
/**
 * Throw a syntax diagnostic, from code-point indices into `chars` rather than
 * the string offsets `badAt` takes. The span defaults to the code point the
 * cursor just consumed, which is the offender at nearly every call site; the
 * few that fault before consuming, or on a whole construct, pass their own.
 *
 * @type {(from?: number, to?: number) => never}
 */
const bad = (from = pos - 1, to = from + 1) => badAt(at(from), at(to));
/**
 * @type {(code: TrefferErrorCode, limit: number, actual?: number) => never}
 */
const cap = (code, limit, actual) =>
  fault(
    RangeError,
    "I-Regexp resource limit exceeded",
    code,
    actual == null ? { limit } : { limit, actual },
  );
/**
 * The one fixed-limit guard. Every counter reports the value that tripped it
 * as `actual`; the pattern-length pre-check is the exception and calls `cap`
 * itself, because it rejects before a scalar count exists to report.
 *
 * @type {(value: number, limit: number, code: TrefferErrorCode) => boolean}
 */
const within = (value, limit, code) => value <= limit || cap(code, limit, value);
/**
 * @type {(msg: string) => never}
 */
const typeErr = (msg) => fault(TypeError, msg);
/** @type {() => never} */
const badScalar = () => typeErr("Subject must contain Unicode scalar values");
/**
 * A lone surrogate in a pattern is found before `chars` exists, and `j` is
 * already a string offset, so it points at itself without the code-point
 * conversion `bad` would apply.
 *
 * @type {(j: number) => never}
 */
const badScalarAt = (j) => badAt(j, j + 1);
/**
 * Shared parser / NFA / matcher state. Compile and match are synchronous, so
 * this is safe — the same pattern as a closure compiler's token cursor.
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
 * Advance past one Unicode scalar, rejecting lone surrogates.
 * High surrogates are `110110xxxxxxxx`, low are `110111xxxxxxxx`.
 *
 * @param {string} subject
 * @param {number} j
 * @param {(j: number) => void} invalid Called with the offset of the lone surrogate.
 * @returns {number}
 */
let readScalar = (subject, j, invalid) => {
  const a = subject.charCodeAt(j);
  if ((a & 0xfc00) === 0xd800) {
    const b = subject.charCodeAt(j + 1);
    // oxlint-disable-next-line no-unused-expressions
    (b & 0xfc00) === 0xdc00 || invalid(j);
    return j + 2;
  }
  // oxlint-disable-next-line no-unused-expressions
  (a & 0xfc00) === 0xdc00 && invalid(j);
  return j + 1;
};

/**
 * Count Unicode scalar values without allocating, rejecting lone surrogates.
 *
 * @param {string} subject
 * @param {number} max
 * @param {(j: number) => void} invalid
 * @param {TrefferErrorCode} code
 */
let scalarCount = (subject, max, invalid, code) => {
  let count = 0;
  for (let j = 0; j < subject.length;) {
    j = readScalar(subject, j, invalid);
    within(++count, max, code);
  }
};

/**
 * Consume the delimiter that closes a construct, faulting on whatever stood
 * where it belonged. The cursor moves past that character either way, so the
 * default span `bad` takes covers exactly the offender.
 *
 * @param {string} close
 */
let expect = (close) => chars[pos++] === close || bad();

/**
 * @param {boolean} neg
 * @param {string} name
 * @param {number} from Code-point index the name starts at, for the span.
 * @returns {Matcher}
 */
let prop = (neg, name, from) => {
  // An unknown property is the name's fault, not the closing brace's, and the
  // cursor has already passed the brace by the time the check runs.
  // oxlint-disable-next-line no-unused-expressions
  PROP.test(name) || bad(from, pos - 1);
  const re = new RegExp("^\\" + (neg ? "P" : "p") + "{" + name + "}$", "u");
  return { test: (char) => re.test(char) };
};

/**
 * @param {boolean} neg
 * @returns {Matcher}
 */
let unicodeProp = (neg) => {
  pos++;
  const from = pos;
  let name = "";
  while (pos < chars.length && chars[pos] !== "}") name += chars[pos++];
  expect("}");
  return prop(neg, name, from);
};

/** @param {string} char */
let isPropEsc = (char) => (char === "p" || char === "P") && chars[pos] === "{";

/** @returns {string} */
let eatChar = () => chars[pos++] ?? bad();

/** @returns {Matcher} */
let esc = () => {
  const char = eatChar();
  if (isPropEsc(char)) return unicodeProp(char === "P");
  // oxlint-disable-next-line no-unused-expressions
  "()*+-.?[\\]^nrt{|}".includes(char) || bad();
  const v = ESC[char] ?? char;
  return { test: (x) => x === v, char: v };
};

/** @returns {Matcher} */
let one = () => {
  const char = chars[pos++];
  if (char === "\\") return esc();
  // oxlint-disable-next-line no-unused-expressions
  (char != null && !"[]-".includes(char)) || bad();
  return { test: (x) => x === char, char };
};

let rangeDash = () => chars[pos] === "-" && chars[pos + 1] !== "]";

/**
 * @param {((x: string) => boolean)[]} preds
 * @param {Matcher} first
 */
let rangePred = (preds, first) => {
  pos++;
  const second = one();
  // `bad()` throws, but a statement-level `|| bad()` is not a control-flow
  // assertion, so the endpoints stay nullable to the checker past this
  // line. The casts restate what the guard just proved. The explicit `0`
  // is `codePointAt`'s own default, which its lib signature requires.
  // oxlint-disable-next-line no-unused-expressions
  (first.char != null &&
    second.char != null &&
    /** @type {number} */ (first.char.codePointAt(0)) <=
      /** @type {number} */ (second.char.codePointAt(0))) ||
    bad();
  const low = /** @type {number} */ (/** @type {string} */ (first.char).codePointAt(0)),
    high = /** @type {number} */ (/** @type {string} */ (second.char).codePointAt(0));
  preds.push((x) => {
    const n = /** @type {number} */ (x.codePointAt(0));
    return n >= low && n <= high;
  });
};

/**
 * Take a literal `-` — the one that leads a class, or the one before `]`.
 *
 * @param {((x: string) => boolean)[]} preds
 */
let dashPred = (preds) => (preds.push((x) => x === "-"), pos++);

/**
 * @param {((x: string) => boolean)[]} preds
 */
let classItem = (preds) => {
  if (chars[pos] === "-" && chars[pos + 1] === "]") return dashPred(preds);
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

/** @param {((x: string) => boolean)[]} preds */
let classPreds = (preds) => {
  if (chars[pos] === "-") dashPred(preds);
  while (pos < chars.length && chars[pos] !== "]") classItem(preds);
  closeClass(preds);
};

/** @returns {Node} */
let cls = () => {
  let neg = chars[pos] === "^",
    preds = /** @type {((x: string) => boolean)[]} */ ([]);
  if (neg) pos++;
  classPreds(preds);
  return [1, (char, spend) => neg !== preds.some((p) => (spend(), p(char)))];
};

let isDigit = () => pos < chars.length && chars[pos] >= "0" && chars[pos] <= "9";

/**
 * @param {number} value
 * @param {number} digits
 * @returns {[number, number]}
 */
let takeDigit = (value, digits) => {
  within(++digits, 6, "TREFFER_MAX_QUANTIFIER_DIGITS");
  value = value * 10 + +chars[pos++];
  within(value, REPEAT, "TREFFER_MAX_REPETITIONS");
  return [value, digits];
};

/** @returns {number} */
let number = () => {
  let value = 0,
    digits = 0;
  while (isDigit()) [value, digits] = takeDigit(value, digits);
  // oxlint-disable-next-line no-unused-expressions
  digits || bad(pos);
  return value;
};

/** @type {() => Node} */
let alt;

/** @returns {Node} */
let group = () => {
  within(++depth, DEPTH, "TREFFER_MAX_GROUP_DEPTH");
  const n = alt();
  expect(")");
  depth--;
  return n;
};

/** @param {string | undefined} char */
let isAnchor = (char) => anchors && (char === "^" || char === "$");

/** @param {string | undefined} char @returns {Node} */
let literalAtom = (char) => {
  // oxlint-disable-next-line no-unused-expressions
  (char != null && !"()[]|*+?{}".includes(char)) || bad();
  return [1, (x) => x === char];
};

/** @param {string | undefined} char @returns {Node} */
let atomRest = (char) => {
  if (char === "\\") return [1, esc().test];
  if (char === ".") return [1, (/** @type {string} */ x) => x !== "\n" && x !== "\r"];
  if (isAnchor(char)) return [2, char === "$"];
  return literalAtom(char);
};

/** @returns {Node} */
let atom = () => {
  const char = chars[pos++];
  if (char === "(") return group();
  if (char === "[") return cls();
  return atomRest(char);
};

/** @type {Record<string, [number, number]>} */
const QUANT = { "*": [0, -1], "+": [1, -1], "?": [0, 1] };

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
 * The bounds of the quantifier following an atom, or nothing when the atom
 * carries none. The one-character quantifiers spell their bounds out in
 * `QUANT`; `{` reads its own.
 *
 * @returns {[number, number] | undefined}
 */
let quant = () => {
  const q = QUANT[chars[pos]];
  if (q) return (pos++, q);
  if (chars[pos] === "{") return brace();
};

/** @returns {Node} */
let piece = () => {
  const a = atom(),
    q = quant();
  return q ? [5, a, q[0], q[1]] : a;
};

let stillBranch = () => pos < chars.length && chars[pos] !== "|" && chars[pos] !== ")";

/** @returns {Node} */
let branch = () => {
  const v = /** @type {Node[]} */ ([]);
  while (stillBranch()) v.push(piece());
  return v.length ? [3, v] : [0];
};

alt = () => {
  const v = [branch()];
  while (chars[pos] === "|") {
    pos++;
    v.push(branch());
  }
  return v.length > 1 ? [4, v] : v[0];
};

/**
 * @param {string} src
 * @param {boolean} wantAnchors
 * @returns {Node}
 */
let parse = (src, wantAnchors) => {
  // oxlint-disable-next-line no-unused-expressions
  src.length <= MAX * 2 || cap("TREFFER_MAX_PATTERN_SCALARS", MAX);
  scalarCount(src, MAX, badScalarAt, "TREFFER_MAX_PATTERN_SCALARS");
  chars = Array.from(src);
  pos = 0;
  depth = 0;
  anchors = wantAnchors;
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
let patch = (o, x) =>
  o.forEach(([j, k]) => {
    states[j][k] = x;
  });

/**
 * @param {number} t
 * @param {State[3]} [v]
 * @returns {Frag}
 */
let leaf = (t, v) => {
  const j = addState(t, -1, -1, v);
  return { s: j, o: [[j, 1]] };
};

/** @param {Frag} a @param {Frag} b @returns {Frag} */
let cat = (a, b) => (patch(a.o, b.s), { s: a.s, o: b.o });

/** @param {Frag} a @param {Frag} b @returns {Frag} */
let either = (a, b) => ({ s: addState(0, a.s, b.s), o: a.o.concat(b.o) });

/**
 * Grow `a` by one step per index in `[from, to)`. Every fragment the builder
 * assembles — a list of neighbours, a quantifier's copies, its optional tail —
 * is this same left-to-right accumulation over a half-open range.
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
 * body, with `a`'s exits routed into it. The split's own second slot is the
 * skip exit, and it is appended last so a caller that wants the loop back edge
 * instead can take it off again.
 *
 * @param {Frag} a
 * @param {Node} body
 * @returns {Frag}
 */
let optional = (a, body) => {
  const b = visit(body),
    j = addState(0, b.s);
  return (patch(a.o, j), { s: a.s, o: b.o.concat([[j, 2]]) });
};

/**
 * @param {Frag} a
 * @param {Node} body
 * @returns {Frag}
 */
let unbounded = (a, body) => {
  const f = optional(a, body),
    j = /** @type {[number, number]} */ (f.o.pop())[0];
  return (patch(f.o, j), { s: f.s, o: [[j, 2]] });
};

/** @param {any} n @returns {Frag} */
let quantified = (n) => {
  const a = repeat(n[2] ? visit(n[1]) : leaf(0), 1, n[2], (f) => cat(f, visit(n[1])));
  if (n[3] < 0) return unbounded(a, n[1]);
  return repeat(a, n[2], n[3], (f) => optional(f, n[1]));
};

/**
 * The composite node kinds, indexed from 3 — the kinds that combine children
 * rather than standing for one state.
 *
 * @type {((n: any) => Frag)[]}
 */
const COMPOSITE = [(n) => fold(n[1], cat), (n) => fold(n[1], either), quantified];

// Kinds 0, 1 and 2 are all one state carrying the node's own value: an empty
// node has no second element, and reading it off the tuple is what the cast
// buys. The rest have children, so they go through the table.
visit = (n) => (n[0] < 3 ? leaf(n[0], /** @type {any} */ (n)[1]) : COMPOSITE[n[0] - 3](n));

/**
 * @param {string} pattern
 * @param {boolean} wantAnchors
 * @returns {Nfa}
 */
let build = (pattern, wantAnchors) => {
  const ast = parse(pattern, wantAnchors);
  states = /** @type {State[]} */ ([]);
  const f = visit(ast),
    end = addState(3);
  patch(f.o, end);
  return { states, start: f.s, end };
};

const spend = () => within(++steps, STEPS, "TREFFER_MAX_TRANSITIONS");

/**
 * @param {State[3]} endAnchor
 * @param {number} at
 */
let atAnchor = (endAnchor, at) => (endAnchor ? at === len : at === 0);

/**
 * @param {State} state
 * @param {number} at
 * @param {number[]} todo
 */
let split = (state, at, todo) => {
  if (state[0] === 0) {
    todo.push(state[1], state[2]);
    return true;
  }
  if (state[0] !== 2) return false;
  // oxlint-disable-next-line no-unused-expressions
  atAnchor(state[3], at) && todo.push(state[1]);
  return true;
};

/**
 * @param {Set<number>} set
 * @param {number} j
 * @param {number} at
 * @param {number[]} todo
 */
let enqueue = (set, j, at, todo) => {
  const state = states[j];
  if (split(state, at, todo)) return;
  set.add(j);
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
 * `pos === len` broke out above, so there is always a code point here.
 *
 * @param {string} str
 * @param {number} at
 * @returns {[string, number]}
 */
let stepChar = (str, at) => {
  const n = /** @type {number} */ (str.codePointAt(at));
  return [String.fromCodePoint(n), at + (n > 0xffff ? 2 : 1)];
};

/**
 * @param {Set<number>} cur
 * @param {number} start
 * @param {number} end
 * @param {boolean} full
 * @param {number} at
 */
let startStep = (cur, start, end, full, at) => {
  // oxlint-disable-next-line no-unused-expressions
  full || add(cur, start, at);
  return cur.has(end) && (!full || at === len);
};

/**
 * @param {string} str
 * @param {Set<number>} cur
 * @param {number} start
 * @param {number} end
 * @param {boolean} full
 */
let scan = (str, cur, start, end, full) => {
  let at = 0;
  for (;;) {
    if (startStep(cur, start, end, full, at)) return true;
    if (at === len) return false;
    const step = stepChar(str, at),
      next = /** @type {Set<number>} */ (new Set());
    cur.forEach((j) => {
      spend();
      const state = states[j];
      // Kind 1 is the only state carrying a predicate in slot 3; `State` is a
      // flat tuple rather than a discriminated union, so restate that here.
      if (
        state[0] === 1 &&
        /** @type {(x: string, spend: () => void) => boolean} */ (state[3])(step[0], spend)
      )
        add(next, state[1], step[1]);
    });
    cur = next;
    at = step[1];
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
  typeof str === "string" || typeErr("Subject must be a string");
  scalarCount(str, STEPS, badScalar, "TREFFER_MAX_SUBJECT_SCALARS");
  states = nfa.states;
  len = str.length;
  steps = 0;
  const cur = /** @type {Set<number>} */ (new Set());
  if (full) add(cur, nfa.start, 0);
  return scan(str, cur, nfa.start, nfa.end, full);
};

/**
 * @param {TrefferOptions} [options]
 * @returns {boolean}
 */
let anchorsOption = (options) => {
  if (options == null) return false;
  const value = options.anchors ?? false;
  // oxlint-disable-next-line no-unused-expressions
  typeof value === "boolean" || typeErr("anchors must be a boolean");
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
  typeof pattern === "string" || typeErr("Pattern must be a string");
  if (options != null && typeof options !== "object") typeErr("Options must be an object");
  const nfa = build(pattern, anchorsOption(options));
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
