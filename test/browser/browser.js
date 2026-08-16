import { compile, match, search } from '/lib/index.js';

const result = document.querySelector('#result');
const violations = [];

document.addEventListener('securitypolicyviolation', event => {
	violations.push(`${event.violatedDirective}: ${event.blockedURI}`);
});

const assert = (value, message) => {
	if (!value) throw Error(message);
};

const rejects = pattern => {
	try {
		compile(pattern);
	} catch (error) {
		return error instanceof SyntaxError;
	}
	return false;
};

try {
	const matcher = compile('(ab|😀|\\p{Lu})+');
	assert(matcher.match('ab😀Ä'), 'compiled Unicode pattern failed');
	assert(!matcher.match('abx'), 'compiled pattern accepted invalid subject');
	assert(search('[0-9]+', 'order-9485-ready'), 'search failed');
	assert(match('^a$', '^a$'), 'strict anchors were not literal');
	assert(match('^a+$', 'aaa', { anchors: true }), 'anchor extension failed');

	for (const pattern of ['(?=a)', '(a)\\1', '[z-a]', '\\p{Any}', '\ud800'])
		assert(rejects(pattern), `unsupported pattern was accepted: ${pattern}`);

	await new Promise(resolve => setTimeout(resolve, 0));
	assert(violations.length === 0, `CSP violation: ${violations.join(', ')}`);
	result.dataset.status = 'passed';
	result.textContent = 'passed';
} catch (error) {
	result.dataset.status = 'failed';
	result.textContent = error.stack || String(error);
}
