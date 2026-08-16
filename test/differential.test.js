import assert from 'node:assert/strict';
import test from 'node:test';
import { compile } from '../lib/index.js';

let native = (pattern, full) => {
	let out = '', cls = false;
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i];
		if (c === '\\') { out += c + pattern[++i]; continue }
		if (c === '[') cls = true;
		else if (c === ']') cls = false;
		out += c === '.' && !cls ? '[^\\n\\r]' : c;
	}
	return new RegExp(full ? '^(?:' + out + ')$' : out, 'u');
};

test('safe RFC subset agrees with ECMAScript mapping', () => {
	const patterns = [
		'',
		'a',
		'.',
		'a*',
		'(a|b)+',
		'[a-z]{0,3}',
		'[^a]+',
		'\\p{L}+',
		'\\P{N}+',
		'[-a]+',
		'(ab|){1,3}',
	];
	const subjects = ['', 'a', 'ab', 'bbb', '42', 'Ä', '😀', 'a\nb'];

	for (const pattern of patterns) {
		const re = compile(pattern);
		for (const subject of subjects) {
			assert.strictEqual(re.match(subject), native(pattern, true).test(subject), 'match ' + pattern + ' / ' + JSON.stringify(subject));
			assert.strictEqual(re.search(subject), native(pattern, false).test(subject), 'search ' + pattern + ' / ' + JSON.stringify(subject));
		}
	}
});
