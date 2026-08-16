import assert from 'node:assert/strict';
import test from 'node:test';
import { compile, isDiagnostic, match, search } from '../lib/index.js';

let check = (run, Type, code, limit, actual) => assert.throws(run, e => {
	assert.ok(e instanceof Type);
	assert.ok(isDiagnostic(e));
	assert.ok(Object.hasOwn(e, 'code'));
	assert.strictEqual(e.code, code);
	if (limit == null) {
		assert.ok(!Object.hasOwn(e, 'limit'));
		assert.ok(!Object.hasOwn(e, 'actual'));
	} else {
		assert.ok(Object.hasOwn(e, 'limit'));
		assert.strictEqual(e.limit, limit);
		if (actual == null) assert.ok(!Object.hasOwn(e, 'actual'));
		else {
			assert.ok(Object.hasOwn(e, 'actual'));
			assert.strictEqual(e.actual, actual);
		}
	}
	return true;
});

test('invalid I-Regexp syntax throws SyntaxError', () => {
	for (const pattern of [
		'(',
		')',
		'[',
		'[]',
		'[^]',
		'[[]',
		'[a[b]',
		'[z-a]',
		'\\d+',
		'(?=a)',
		'(a)\\1',
		'a+?',
		'a{,2}',
		'a{2,1}',
		'a{2',
		'\ud800',
	]) {
		check(() => compile(pattern), SyntaxError, 'TREFFER_SYNTAX');
	}
});

test('API type errors are explicit', () => {
	for (const run of [
		() => compile(),
		() => compile(1),
		() => compile('a', true),
		() => compile('a', { anchors: 1 }),
		() => compile('a').match(),
		() => match('a', 1),
	]) assert.throws(run, e => e instanceof TypeError && isDiagnostic(e) && !Object.hasOwn(e, 'code'));
});

test('compile-time resource limits expose distinct diagnostics', () => {
	assert.doesNotThrow(() => compile('('.repeat(64) + 'a' + ')'.repeat(64)), 'deepest group');
	check(() => compile('('.repeat(65) + 'a' + ')'.repeat(65)), RangeError, 'TREFFER_MAX_GROUP_DEPTH', 64, 65);

	assert.doesNotThrow(() => compile('a{1024}'), 'largest repetition');
	check(() => compile('a{1025}'), RangeError, 'TREFFER_MAX_REPETITIONS', 1024, 1025);
	check(() => compile('a{0001024}'), RangeError, 'TREFFER_MAX_QUANTIFIER_DIGITS', 6, 7);

	assert.doesNotThrow(() => compile('a'.repeat(4095)), 'largest NFA');
	check(() => compile('a'.repeat(4096)), RangeError, 'TREFFER_MAX_NFA_STATES', 4096, 4097);
	assert.doesNotThrow(() => compile('[' + 'a'.repeat(4094) + ']'), 'largest pattern');
	check(() => compile('[' + 'a'.repeat(4095) + ']'), RangeError, 'TREFFER_MAX_PATTERN_SCALARS', 4096, 4097);
	check(() => compile('a'.repeat(8193)), RangeError, 'TREFFER_MAX_PATTERN_SCALARS', 4096);
});

test('subject validation and work limits throw', () => {
	const re = compile('a');
	assert.throws(() => re.match('\ud800'), e => e instanceof TypeError && isDiagnostic(e) && !Object.hasOwn(e, 'code'));
	check(() => search('', 'a'.repeat(1_000_001)), RangeError, 'TREFFER_MAX_SUBJECT_SCALARS', 1_000_000, 1_000_001);

	const expensive = compile('[' + 'b'.repeat(4093) + ']');
	check(() => expensive.search('a'.repeat(1000)), RangeError, 'TREFFER_MAX_TRANSITIONS', 1_000_000, 1_000_001);
});

test('diagnostic provenance cannot be copied', () => {
	for (const value of [null, undefined, 1, 'TREFFER_SYNTAX', {}, SyntaxError('host')])
		assert.strictEqual(isDiagnostic(value), false);

	const spoof = Object.assign(SyntaxError('spoof'), { code: 'TREFFER_SYNTAX' });
	assert.strictEqual(isDiagnostic(spoof), false);
});

test('diagnostic provenance is local to a module instance', async () => {
	const other = await import('../lib/index.js?instance=provenance');
	let first, second;
	try { compile('(') } catch (e) { first = e }
	try { other.compile('(') } catch (e) { second = e }

	assert.ok(isDiagnostic(first));
	assert.ok(other.isDiagnostic(second));
	assert.strictEqual(isDiagnostic(second), false);
	assert.strictEqual(other.isDiagnostic(first), false);
});

test('captured provenance operations resist prototype replacement', () => {
	const add = WeakSet.prototype.add;
	const has = WeakSet.prototype.has;
	try {
		WeakSet.prototype.add = function () { return this };
		WeakSet.prototype.has = () => true;
		assert.strictEqual(isDiagnostic(Object.assign(SyntaxError('spoof'), { code: 'TREFFER_SYNTAX' })), false);
		check(() => compile('('), SyntaxError, 'TREFFER_SYNTAX');
	} finally {
		WeakSet.prototype.add = add;
		WeakSet.prototype.has = has;
	}
});
