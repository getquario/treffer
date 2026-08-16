import assert from 'node:assert/strict';
import { FuzzedDataProvider } from '@jazzer.js/core';
import { compile, isDiagnostic } from '../lib/index.js';

const ATOM = ['a', 'b', '.', '[a-z]', '[^b]', '[-a]', '\\p{L}', '\\P{N}', '😀'];
const pick = (data, values) => values[data.consumeIntegralInRange(0, values.length - 1)];

let pattern = (data, depth) => {
	const a = pick(data, ATOM);
	if (!depth || data.remainingBytes < 2) return a;
	const k = data.consumeIntegralInRange(0, 4);
	if (k === 0) return pattern(data, depth - 1) + pattern(data, depth - 1);
	if (k === 1) return `(${pattern(data, depth - 1)}|${pattern(data, depth - 1)})`;
	if (k === 2) return `(${pattern(data, depth - 1)})${pick(data, ['*', '+', '?'])}`;
	if (k === 3) {
		const lo = data.consumeIntegralInRange(0, 3);
		return `${a}{${lo},${data.consumeIntegralInRange(lo, 5)}}`;
	}
	return `(${pattern(data, depth - 1)}|)`;
};

let native = (p, full) => {
	let out = '', cls = false;
	for (let i = 0; i < p.length; i++) {
		const c = p[i];
		if (c === '\\') { out += c + p[++i]; continue }
		if (c === '[') cls = true;
		else if (c === ']') cls = false;
		out += c === '.' && !cls ? '[^\\n\\r]' : c;
	}
	return new RegExp(full ? '^(?:' + out + ')$' : out, 'u');
};

// Fixed invariants run for every fuzz worker.
assert.equal(compile('(a+)+').match('a'.repeat(1000)), true);
assert.equal(compile('(a+)+$', { anchors: true }).search('a'.repeat(1000) + '!'), false);
assert.equal(compile('(a*)*').match('a'.repeat(1000)), true);
for (const [p, code] of [
	['(', 'TREFFER_SYNTAX'],
	['('.repeat(65) + 'a' + ')'.repeat(65), 'TREFFER_MAX_GROUP_DEPTH'],
	['a{0001024}', 'TREFFER_MAX_QUANTIFIER_DIGITS'],
	['a{1025}', 'TREFFER_MAX_REPETITIONS'],
	['a'.repeat(4096), 'TREFFER_MAX_NFA_STATES'],
	['[' + 'a'.repeat(4095) + ']', 'TREFFER_MAX_PATTERN_SCALARS'],
]) assert.throws(() => compile(p), e => isDiagnostic(e) && e.code === code);

export function fuzz(input) {
	const data = new FuzzedDataProvider(input);
	const p = pattern(data, 3);
	const subjects = ['', 'a', 'ab', 'bbb', '42', 'Ä', '😀', 'a\nb'];
	const re = compile(p);

	for (const [name, full] of [['match', true], ['search', false]]) {
		const expected = subjects.map(x => native(p, full).test(x));
		const actual = subjects.map(x => re[name](x));
		assert.deepStrictEqual(actual, expected, name + ' mismatch for ' + p);
		assert.deepStrictEqual(subjects.map(x => re[name](x)), actual, 'non-deterministic ' + name);
	}

	const anchored = '^' + p + '$';
	const actual = subjects.map(x => compile(anchored, { anchors: true }).search(x));
	const expected = subjects.map(x => native(p, true).test(x));
	assert.deepStrictEqual(actual, expected, 'anchor mismatch for ' + p);
}
