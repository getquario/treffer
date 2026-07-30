/**
 * Checking RFC 9485 I-Regexp compiler backed by a bounded Thompson NFA.
 */

/** @import { TrefferErrorCode } from './index.js' */

const PROP = /^(?:L[lmotu]?|M[cen]?|N[dlo]?|P[cdefios]?|Z[lps]?|S[ckmo]?|C[cfno]?)$/;
const MAX = 4096, DEPTH = 64, REPEAT = 1024, STEPS = 1e6;

let diags = new WeakSet(), mark = diags.add.bind(diags);
export let isDiagnostic = diags.has.bind(diags);
/**
 * `code` is typed to the published union, so a code this module throws but
 * `index.d.ts` does not declare fails to compile rather than shipping.
 *
 * @param {TrefferErrorCode} [code]
 * @param {number} [limit]
 * @param {number} [actual]
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

// Count Unicode scalar values without allocating, rejecting lone surrogates.
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

let parse = (src, anchors) => {
	src.length <= MAX * 2 || cap('TREFFER_MAX_PATTERN_SCALARS', MAX);
	scalarCount(src, MAX, bad, 'TREFFER_MAX_PATTERN_SCALARS');
	const s = Array.from(src);
	let i = 0, depth = 0;
	const prop = (neg, p) => {
		PROP.test(p) || bad();
		const r = new RegExp('^\\' + (neg ? 'P' : 'p') + '{' + p + '}$', 'u');
		return { p: c => r.test(c) };
	};
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
	const cls = () => {
		let neg = s[i] === '^', ps = [];
		if (neg) i++;
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
				(a.c != null && b.c != null && a.c.codePointAt() <= b.c.codePointAt()) || bad();
				const lo = a.c.codePointAt(), hi = b.c.codePointAt();
				ps.push(x => { const n = x.codePointAt(); return n >= lo && n <= hi });
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
	let alt;
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
	const branch = () => {
		const v = [];
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

let build = (pattern, anchors) => {
	const ast = parse(pattern, anchors), st = [];
	const add = (t, x = -1, y = -1, v) => {
		st.length < MAX || cap('TREFFER_MAX_NFA_STATES', MAX, st.length + 1);
		return st.push([t, x, y, v]) - 1;
	};
	const patch = (o, x) => o.forEach(([j, k]) => { st[j][k] = x });
	const empty = () => { const j = add(0); return { s: j, o: [[j, 1]] } };
	const cat = (a, b) => (patch(a.o, b.s), { s: a.s, o: b.o });
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

let run = (nfa, str, full) => {
	typeof str === 'string' || (() => { throw fault(TypeError, 'Subject must be a string') })();
	scalarCount(str, STEPS, () => { throw fault(TypeError, 'Subject must contain Unicode scalar values') }, 'TREFFER_MAX_SUBJECT_SCALARS');
	const { st, start, end } = nfa, len = str.length;
	let cur = new Set(), steps = 0;
	const spend = () => { ++steps <= STEPS || cap('TREFFER_MAX_TRANSITIONS', STEPS, steps) };
	const add = (set, root, pos) => {
		const todo = [root], seen = new Set();
		while (todo.length) {
			const j = todo.pop();
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
		const nextPos = pos + (n > 0xffff ? 2 : 1), next = new Set();
		for (const j of cur) {
			spend();
			const q = st[j];
			if (q[0] === 1 && q[3](c, spend)) add(next, q[1], nextPos);
		}
		cur = next;
		pos = nextPos;
	}
	return false;
};

export let compile = (pattern, options) => {
	typeof pattern === 'string' || (() => { throw fault(TypeError, 'Pattern must be a string') })();
	if (options != null && typeof options !== 'object') throw fault(TypeError, 'Options must be an object');
	const anchors = options?.anchors ?? false;
	typeof anchors === 'boolean' || (() => { throw fault(TypeError, 'anchors must be a boolean') })();
	const nfa = build(pattern, anchors);
	return Object.freeze({
		match: subject => run(nfa, subject, true),
		search: subject => run(nfa, subject, false),
	});
};

export let match = (pattern, subject, options) => compile(pattern, options).match(subject);
export let search = (pattern, subject, options) => compile(pattern, options).search(subject);
