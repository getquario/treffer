import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { compile, isDiagnostic } from '../lib/index.js';

const notOk = (value, message) => assert.ok(!value, message);

test('source contains no string-to-code constructs', () => {
	const src = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
	notOk(/\beval\b|\bFunction\s*\(|new\s+Function/.test(src));
});

test('adversarial regular expressions stay bounded', () => {
	const n = 50_000, text = 'a'.repeat(n) + '!';
	const t0 = Date.now();
	const limited = (run, code) => assert.throws(run, e =>
		e instanceof RangeError && isDiagnostic(e) && e.code === code
	);

	limited(() => compile('(a+)+$', { anchors: true }).search(text), 'TREFFER_MAX_TRANSITIONS');
	assert.ok(compile('(a*)*').match('a'.repeat(n)), 'nullable cycle');
	limited(() => compile('(a|aa)+$', { anchors: true }).search(text), 'TREFFER_MAX_TRANSITIONS');
	limited(() => compile('a{1000000}'), 'TREFFER_MAX_REPETITIONS');
	limited(() => compile('a{1024}a{1024}a{1024}a{1024}'), 'TREFFER_MAX_NFA_STATES');
	limited(() => compile('a'.repeat(5_000_000)), 'TREFFER_MAX_PATTERN_SCALARS');

	assert.ok(Date.now() - t0 < 1500, 'completes within the work budget');
});
