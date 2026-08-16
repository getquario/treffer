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
 * @typedef {{ p: (x: string) => boolean, c?: string }} Matcher
 */

/**
 * The tuple-encoded AST, discriminated on its first element: 0 empty,
 * 1 predicate, 2 anchor (`true` for `$`), 3 concatenation, 4 alternation,
 * 5 quantified, where `hi` is -1 for unbounded.
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

/** @internal @typedef {{ st: State[], start: number, end: number }} Nfa */

const PROP = /^(?:L[lmotu]?|M[cen]?|N[dlo]?|P[cdefios]?|Z[lps]?|S[ckmo]?|C[cfno]?)$/;
const MAX = 4096, DEPTH = 64, REPEAT = 1024, STEPS = 1e6;

let diags = new WeakSet(), mark = diags.add.bind(diags);
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
 * `code` is typed to the published union, so a code this module throws but the
 * `TrefferErrorCode` typedef does not declare fails to compile rather than
 * shipping.
 *
 * @param {(msg: string) => Error} Type
 * @param {string} msg
 * @param {TrefferErrorCode} [code]
 * @param {number} [limit]
 * @param {number} [actual]
 * @returns {TrefferDiagnostic}
 */
let fault = (Type, msg, code, limit, actual) => {
	const e = /** @type {Error & { code: TrefferErrorCode, limit: number, actual: number }} */ (Type(msg));
	if (code) e.code = code;
	if (limit != null) e.limit = limit;
	if (actual != null) e.actual = actual;
	return mark(e), e;
};
/** @returns {never} */
const bad = () => { throw fault(SyntaxError, 'Invalid I-Regexp', 'TREFFER_SYNTAX') };
/**
 * @param {TrefferErrorCode} code
 * @param {number} [limit]
 * @param {number} [actual]
 * @returns {never}
 */
const cap = (code, limit, actual) => { throw fault(RangeError, 'I-Regexp resource limit exceeded', code, limit, actual) };

/**
 * Count Unicode scalar values without allocating, rejecting lone surrogates.
 *
 * @param {string} s
 * @param {number} max
 * @param {() => void} invalid
 * @param {TrefferErrorCode} code
 */
let scalarCount = (s, max, invalid, code) => {
	let count = 0;
	for (let j = 0; j < s.length; j++) {
		const a = s.charCodeAt(j);
		if (a >= 0xd800 && a <= 0xdbff) {
			const b = s.charCodeAt(++j);
			(b >= 0xdc00 && b <= 0xdfff) || invalid();
		} else if (a >= 0xdc00 && a <= 0xdfff) invalid();
		++count <= max || cap(code, max, count);
	}
};

/**
 * @param {string} src
 * @param {boolean} anchors
 * @returns {Node}
 */
let parse = (src, anchors) => {
	src.length <= MAX * 2 || cap('TREFFER_MAX_PATTERN_SCALARS', MAX);
	scalarCount(src, MAX, bad, 'TREFFER_MAX_PATTERN_SCALARS');
	const s = Array.from(src);
	let i = 0, depth = 0;
	/**
	 * @param {boolean} neg
	 * @param {string} p
	 * @returns {Matcher}
	 */
	const prop = (neg, p) => {
		PROP.test(p) || bad();
		const r = new RegExp('^\\' + (neg ? 'P' : 'p') + '{' + p + '}$', 'u');
		return { p: c => r.test(c) };
	};
	/** @returns {Matcher} */
	const esc = () => {
		const c = s[i++] ?? bad();
		if ((c === 'p' || c === 'P') && s[i] === '{') {
			i++;
			let p = '';
			while (i < s.length && s[i] !== '}') p += s[i++];
			s[i++] === '}' || bad();
			return prop(c === 'P', p);
		}
		'()*+-.?[\\]^nrt{|}'.includes(c) || bad();
		const v = c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c;
		return { p: x => x === v, c: v };
	};
	/** @returns {Node} */
	const cls = () => {
		let neg = s[i] === '^', ps = /** @type {((x: string) => boolean)[]} */ ([]);
		if (neg) i++;
		/** @returns {Matcher} */
		const one = () => {
			const c = s[i++];
			if (c === '\\') return esc();
			(c != null && c !== '[' && c !== ']' && c !== '-') || bad();
			return { p: x => x === c, c };
		};
		if (s[i] === '-') { ps.push(x => x === '-'); i++ }
		while (i < s.length && s[i] !== ']') {
			if (s[i] === '-' && s[i + 1] === ']') {
				ps.push(x => x === '-'); i++; continue;
			}
			const a = one();
			if (s[i] === '-' && s[i + 1] !== ']') {
				i++;
				const b = one();
				// `bad()` throws, but a statement-level `|| bad()` is not a control-flow
				// assertion, so the endpoints stay nullable to the checker past this
				// line. The casts restate what the guard just proved. The explicit `0`
				// is `codePointAt`'s own default, which its lib signature requires.
				(a.c != null && b.c != null && /** @type {number} */ (a.c.codePointAt(0)) <= /** @type {number} */ (b.c.codePointAt(0))) || bad();
				const lo = /** @type {number} */ (/** @type {string} */ (a.c).codePointAt(0)), hi = /** @type {number} */ (/** @type {string} */ (b.c).codePointAt(0));
				ps.push(x => { const n = /** @type {number} */ (x.codePointAt(0)); return n >= lo && n <= hi });
			} else ps.push(a.p);
		}
		(ps.length && s[i++] === ']') || bad();
		return [1, (c, spend) => {
			let yes = false;
			for (const p of ps) {
				spend();
				if (p(c)) { yes = true; break }
			}
			return neg !== yes;
		}];
	};
	/** @returns {number} */
	const number = () => {
		let n = 0, d = 0;
		while (i < s.length && s[i] >= '0' && s[i] <= '9') {
			++d <= 6 || cap('TREFFER_MAX_QUANTIFIER_DIGITS', 6, d);
			n = n * 10 + +s[i++];
			n <= REPEAT || cap('TREFFER_MAX_REPETITIONS', REPEAT, n);
		}
		d || bad();
		return n;
	};
	/** @type {() => Node} */
	let alt;
	/** @returns {Node} */
	const atom = () => {
		const c = s[i++];
		if (c === '(') {
			++depth <= DEPTH || cap('TREFFER_MAX_GROUP_DEPTH', DEPTH, depth);
			const n = alt();
			s[i++] === ')' || bad();
			depth--;
			return n;
		}
		if (c === '[') return cls();
		if (c === '\\') { const e = esc(); return [1, e.p] }
		if (c === '.') return [1, x => x !== '\n' && x !== '\r'];
		if (anchors && (c === '^' || c === '$')) return [2, c === '$'];
		(c != null && !'()[]|*+?{}'.includes(c)) || bad();
		return [1, x => x === c];
	};
	/** @returns {Node} */
	const piece = () => {
		const a = atom(), c = s[i];
		let lo, hi;
		if (c === '*' || c === '+' || c === '?') {
			i++;
			lo = c === '+' ? 1 : 0;
			hi = c === '?' ? 1 : -1;
		} else if (c === '{') {
			i++;
			lo = number();
			if (s[i] === ',') {
				i++;
				hi = s[i] === '}' ? -1 : number();
			} else hi = lo;
			s[i++] === '}' || bad();
			(hi < 0 || lo <= hi) || bad();
		} else return a;
		return [5, a, lo, hi];
	};
	/** @returns {Node} */
	const branch = () => {
		const v = /** @type {Node[]} */ ([]);
		while (i < s.length && s[i] !== '|' && s[i] !== ')') v.push(piece());
		return v.length ? [3, v] : [0];
	};
	alt = () => {
		const v = [branch()];
		while (s[i] === '|') { i++; v.push(branch()) }
		return v.length > 1 ? [4, v] : v[0];
	};
	const out = alt();
	i === s.length || bad();
	return out;
};

/**
 * @param {string} pattern
 * @param {boolean} anchors
 * @returns {Nfa}
 */
let build = (pattern, anchors) => {
	const ast = parse(pattern, anchors), st = /** @type {State[]} */ ([]);
	/**
	 * @param {number} t
	 * @param {number} [x]
	 * @param {number} [y]
	 * @param {State[3]} [v]
	 * @returns {number}
	 */
	const add = (t, x = -1, y = -1, v) => {
		st.length < MAX || cap('TREFFER_MAX_NFA_STATES', MAX, st.length + 1);
		return st.push([t, x, y, v]) - 1;
	};
	/** @param {[number, number][]} o @param {number} x */
	const patch = (o, x) => o.forEach(([j, k]) => { st[j][k] = x });
	/** @returns {Frag} */
	const empty = () => { const j = add(0); return { s: j, o: [[j, 1]] } };
	/** @param {Frag} a @param {Frag} b @returns {Frag} */
	const cat = (a, b) => (patch(a.o, b.s), { s: a.s, o: b.o });
	/** @param {Node} n @returns {Frag} */
	const visit = n => {
		if (!n[0]) return empty();
		if (n[0] === 1) { const j = add(1, -1, -1, n[1]); return { s: j, o: [[j, 1]] } }
		if (n[0] === 2) { const j = add(2, -1, -1, n[1]); return { s: j, o: [[j, 1]] } }
		if (n[0] === 3) {
			let a = visit(n[1][0]);
			for (let k = 1; k < n[1].length; k++) a = cat(a, visit(n[1][k]));
			return a;
		}
		if (n[0] === 4) {
			let a = visit(n[1][0]);
			for (let k = 1; k < n[1].length; k++) {
				const b = visit(n[1][k]), j = add(0, a.s, b.s);
				a = { s: j, o: a.o.concat(b.o) };
			}
			return a;
		}
		let a = n[2] ? visit(n[1]) : empty();
		for (let k = 1; k < n[2]; k++) a = cat(a, visit(n[1]));
		if (n[3] < 0) {
			const b = visit(n[1]), j = add(0, b.s);
			patch(a.o, j); patch(b.o, j);
			return { s: a.s, o: [[j, 2]] };
		}
		for (let k = n[2]; k < n[3]; k++) {
			const b = visit(n[1]), j = add(0, b.s);
			patch(a.o, j);
			a = { s: a.s, o: b.o.concat([[j, 2]]) };
		}
		return a;
	};
	const f = visit(ast), end = add(3);
	patch(f.o, end);
	return { st, start: f.s, end };
};

/**
 * @param {Nfa} nfa
 * @param {string} str
 * @param {boolean} full
 * @returns {boolean}
 */
let run = (nfa, str, full) => {
	typeof str === 'string' || (() => { throw fault(TypeError, 'Subject must be a string') })();
	scalarCount(str, STEPS, () => { throw fault(TypeError, 'Subject must contain Unicode scalar values') }, 'TREFFER_MAX_SUBJECT_SCALARS');
	const { st, start, end } = nfa, len = str.length;
	let cur = /** @type {Set<number>} */ (new Set()), steps = 0;
	const spend = () => { ++steps <= STEPS || cap('TREFFER_MAX_TRANSITIONS', STEPS, steps) };
	/**
	 * @param {Set<number>} set
	 * @param {number} root
	 * @param {number} pos
	 */
	const add = (set, root, pos) => {
		const todo = [root], seen = /** @type {Set<number>} */ (new Set());
		while (todo.length) {
			// The loop guard proves the stack is non-empty.
			const j = /** @type {number} */ (todo.pop());
			if (j < 0 || seen.has(j)) continue;
			seen.add(j);
			spend();
			const q = st[j];
			if (q[0] === 0) { todo.push(q[1], q[2]); continue }
			if (q[0] === 2) { (q[3] ? pos === len : pos === 0) && todo.push(q[1]); continue }
			set.add(j);
		}
	};
	if (full) add(cur, start, 0);
	for (let pos = 0; pos <= len;) {
		full || add(cur, start, pos);
		if (cur.has(end) && (!full || pos === len)) return true;
		if (pos === len) break;
		// `pos === len` broke out above, so there is always a code point here.
		const n = /** @type {number} */ (str.codePointAt(pos)), c = String.fromCodePoint(n);
		const nextPos = pos + (n > 0xffff ? 2 : 1), next = /** @type {Set<number>} */ (new Set());
		for (const j of cur) {
			spend();
			const q = st[j];
			// Kind 1 is the only state carrying a predicate in slot 3; `State` is a
			// flat tuple rather than a discriminated union, so restate that here.
			if (q[0] === 1 && /** @type {(x: string, spend: () => void) => boolean} */ (q[3])(c, spend)) add(next, q[1], nextPos);
		}
		cur = next;
		pos = nextPos;
	}
	return false;
};

/**
 * Compile and validate an RFC 9485 I-Regexp.
 *
 * @param {string} pattern
 * @param {TrefferOptions} [options]
 * @returns {Treffer}
 */
export let compile = (pattern, options) => {
	typeof pattern === 'string' || (() => { throw fault(TypeError, 'Pattern must be a string') })();
	if (options != null && typeof options !== 'object') throw fault(TypeError, 'Options must be an object');
	const anchors = options?.anchors ?? false;
	typeof anchors === 'boolean' || (() => { throw fault(TypeError, 'anchors must be a boolean') })();
	const nfa = build(pattern, anchors);
	return Object.freeze({
		/** @param {string} subject */
		match: subject => run(nfa, subject, true),
		/** @param {string} subject */
		search: subject => run(nfa, subject, false),
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
