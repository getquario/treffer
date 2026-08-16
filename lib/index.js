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
 * @param {string} subject
 * @param {number} max
 * @param {() => void} invalid
 * @param {TrefferErrorCode} code
 */
let scalarCount = (subject, max, invalid, code) => {
	let count = 0;
	for (let j = 0; j < subject.length; j++) {
		const a = subject.charCodeAt(j);
		if (a >= 0xd800 && a <= 0xdbff) {
			const b = subject.charCodeAt(++j);
			(b >= 0xdc00 && b <= 0xdfff) || invalid(); // oxlint-disable-line no-unused-expressions
		} else if (a >= 0xdc00 && a <= 0xdfff) invalid();
		++count <= max || cap(code, max, count); // oxlint-disable-line no-unused-expressions
	}
};

/**
 * @param {string} src
 * @param {boolean} anchors
 * @returns {Node}
 */
let parse = (src, anchors) => {
	src.length <= MAX * 2 || cap('TREFFER_MAX_PATTERN_SCALARS', MAX); // oxlint-disable-line no-unused-expressions
	scalarCount(src, MAX, bad, 'TREFFER_MAX_PATTERN_SCALARS');
	const chars = Array.from(src);
	let pos = 0, depth = 0;
	/**
	 * @param {boolean} neg
	 * @param {string} name
	 * @returns {Matcher}
	 */
	const prop = (neg, name) => {
		PROP.test(name) || bad(); // oxlint-disable-line no-unused-expressions
		const re = new RegExp('^\\' + (neg ? 'P' : 'p') + '{' + name + '}$', 'u');
		return { test: char => re.test(char) };
	};
	/** @returns {Matcher} */
	const esc = () => {
		const char = chars[pos++] ?? bad();
		if ((char === 'p' || char === 'P') && chars[pos] === '{') {
			pos++;
			let p = '';
			while (pos < chars.length && chars[pos] !== '}') p += chars[pos++];
			chars[pos++] === '}' || bad(); // oxlint-disable-line no-unused-expressions
			return prop(char === 'P', p);
		}
		'()*+-.?[\\]^nrt{|}'.includes(char) || bad(); // oxlint-disable-line no-unused-expressions
		const v = char === 'n' ? '\n' : char === 'r' ? '\r' : char === 't' ? '\t' : char;
		return { test: x => x === v, char: v };
	};
	/** @returns {Node} */
	const cls = () => {
		let neg = chars[pos] === '^', preds = /** @type {((x: string) => boolean)[]} */ ([]);
		if (neg) pos++;
		/** @returns {Matcher} */
		const one = () => {
			const char = chars[pos++];
			if (char === '\\') return esc();
			(char != null && char !== '[' && char !== ']' && char !== '-') || bad(); // oxlint-disable-line no-unused-expressions
			return { test: x => x === char, char };
		};
		if (chars[pos] === '-') { preds.push(x => x === '-'); pos++ }
		while (pos < chars.length && chars[pos] !== ']') {
			if (chars[pos] === '-' && chars[pos + 1] === ']') {
				preds.push(x => x === '-'); pos++; continue;
			}
			const first = one();
			if (chars[pos] === '-' && chars[pos + 1] !== ']') {
				pos++;
				const second = one();
				// `bad()` throws, but a statement-level `|| bad()` is not a control-flow
				// assertion, so the endpoints stay nullable to the checker past this
				// line. The casts restate what the guard just proved. The explicit `0`
				// is `codePointAt`'s own default, which its lib signature requires.
				(first.char != null && second.char != null && /** @type {number} */ (first.char.codePointAt(0)) <= /** @type {number} */ (second.char.codePointAt(0))) || bad(); // oxlint-disable-line no-unused-expressions
				const low = /** @type {number} */ (/** @type {string} */ (first.char).codePointAt(0)), high = /** @type {number} */ (/** @type {string} */ (second.char).codePointAt(0));
				preds.push(x => { const n = /** @type {number} */ (x.codePointAt(0)); return n >= low && n <= high });
			} else preds.push(first.test);
		}
		(preds.length && chars[pos++] === ']') || bad(); // oxlint-disable-line no-unused-expressions
		return [1, (char, spend) => {
			let yes = false;
			for (const p of preds) {
				spend();
				if (p(char)) { yes = true; break }
			}
			return neg !== yes;
		}];
	};
	/** @returns {number} */
	const number = () => {
		let value = 0, digits = 0;
		while (pos < chars.length && chars[pos] >= '0' && chars[pos] <= '9') {
			++digits <= 6 || cap('TREFFER_MAX_QUANTIFIER_DIGITS', 6, digits); // oxlint-disable-line no-unused-expressions
			value = value * 10 + +chars[pos++];
			value <= REPEAT || cap('TREFFER_MAX_REPETITIONS', REPEAT, value); // oxlint-disable-line no-unused-expressions
		}
		digits || bad(); // oxlint-disable-line no-unused-expressions
		return value;
	};
	/** @type {() => Node} */
	let alt;
	/** @returns {Node} */
	const atom = () => {
		const char = chars[pos++];
		if (char === '(') {
			++depth <= DEPTH || cap('TREFFER_MAX_GROUP_DEPTH', DEPTH, depth); // oxlint-disable-line no-unused-expressions
			const n = alt();
			chars[pos++] === ')' || bad(); // oxlint-disable-line no-unused-expressions
			depth--;
			return n;
		}
		if (char === '[') return cls();
		if (char === '\\') { const e = esc(); return [1, e.test] }
		if (char === '.') return [1, x => x !== '\n' && x !== '\r'];
		if (anchors && (char === '^' || char === '$')) return [2, char === '$'];
		(char != null && !'()[]|*+?{}'.includes(char)) || bad(); // oxlint-disable-line no-unused-expressions
		return [1, x => x === char];
	};
	/** @returns {Node} */
	const piece = () => {
		const a = atom(), c = chars[pos];
		let lo, hi;
		if (c === '*' || c === '+' || c === '?') {
			pos++;
			lo = c === '+' ? 1 : 0;
			hi = c === '?' ? 1 : -1;
		} else if (c === '{') {
			pos++;
			lo = number();
			if (chars[pos] === ',') {
				pos++;
				hi = chars[pos] === '}' ? -1 : number();
			} else hi = lo;
			chars[pos++] === '}' || bad(); // oxlint-disable-line no-unused-expressions
			(hi < 0 || lo <= hi) || bad(); // oxlint-disable-line no-unused-expressions
		} else return a;
		return [5, a, lo, hi];
	};
	/** @returns {Node} */
	const branch = () => {
		const v = /** @type {Node[]} */ ([]);
		while (pos < chars.length && chars[pos] !== '|' && chars[pos] !== ')') v.push(piece());
		return v.length ? [3, v] : [0];
	};
	alt = () => {
		const v = [branch()];
		while (chars[pos] === '|') { pos++; v.push(branch()) }
		return v.length > 1 ? [4, v] : v[0];
	};
	const out = alt();
	pos === chars.length || bad(); // oxlint-disable-line no-unused-expressions
	return out;
};

/**
 * @param {string} pattern
 * @param {boolean} anchors
 * @returns {Nfa}
 */
let build = (pattern, anchors) => {
	const ast = parse(pattern, anchors), states = /** @type {State[]} */ ([]);
	/**
	 * @param {number} t
	 * @param {number} [x]
	 * @param {number} [y]
	 * @param {State[3]} [v]
	 * @returns {number}
	 */
	const add = (t, x = -1, y = -1, v) => {
		states.length < MAX || cap('TREFFER_MAX_NFA_STATES', MAX, states.length + 1); // oxlint-disable-line no-unused-expressions
		return states.push([t, x, y, v]) - 1;
	};
	/** @param {[number, number][]} o @param {number} x */
	const patch = (o, x) => o.forEach(([j, k]) => { states[j][k] = x });
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
	return { states, start: f.s, end };
};

/**
 * @param {Nfa} nfa
 * @param {string} str
 * @param {boolean} full
 * @returns {boolean}
 */
let run = (nfa, str, full) => {
	typeof str === 'string' || (() => { throw fault(TypeError, 'Subject must be a string') })(); // oxlint-disable-line no-unused-expressions
	scalarCount(str, STEPS, () => { throw fault(TypeError, 'Subject must contain Unicode scalar values') }, 'TREFFER_MAX_SUBJECT_SCALARS');
	const { states, start, end } = nfa, len = str.length;
	let cur = /** @type {Set<number>} */ (new Set()), steps = 0;
	const spend = () => { ++steps <= STEPS || cap('TREFFER_MAX_TRANSITIONS', STEPS, steps) }; // oxlint-disable-line no-unused-expressions
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
			const state = states[j];
			if (state[0] === 0) { todo.push(state[1], state[2]); continue }
			if (state[0] === 2) { (state[3] ? pos === len : pos === 0) && todo.push(state[1]); continue } // oxlint-disable-line no-unused-expressions
			set.add(j);
		}
	};
	if (full) add(cur, start, 0);
	for (let pos = 0; pos <= len;) {
		full || add(cur, start, pos); // oxlint-disable-line no-unused-expressions
		if (cur.has(end) && (!full || pos === len)) return true;
		if (pos === len) break;
		// `pos === len` broke out above, so there is always a code point here.
		const n = /** @type {number} */ (str.codePointAt(pos)), c = String.fromCodePoint(n);
		const nextPos = pos + (n > 0xffff ? 2 : 1), next = /** @type {Set<number>} */ (new Set());
		for (const j of cur) {
			spend();
			const state = states[j];
			// Kind 1 is the only state carrying a predicate in slot 3; `State` is a
			// flat tuple rather than a discriminated union, so restate that here.
			if (state[0] === 1 && /** @type {(x: string, spend: () => void) => boolean} */ (state[3])(c, spend)) add(next, state[1], nextPos);
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
	typeof pattern === 'string' || (() => { throw fault(TypeError, 'Pattern must be a string') })(); // oxlint-disable-line no-unused-expressions
	if (options != null && typeof options !== 'object') throw fault(TypeError, 'Options must be an object');
	const anchors = options?.anchors ?? false;
	typeof anchors === 'boolean' || (() => { throw fault(TypeError, 'anchors must be a boolean') })(); // oxlint-disable-line no-unused-expressions
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
