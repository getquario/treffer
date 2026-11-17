# Security Policy

## Security considerations

Treffer is designed to evaluate untrusted patterns and subjects without backtracking. It parses patterns into bounded Thompson NFAs and limits pattern length, parser depth, repetition expansion, NFA size, subject length, and matching work.

Resource limits raise `RangeError`. If a rejected or over-budget pattern should count as no match in your application, catch that error at the call site.

Treffer runs in the current process. Its limits bound work inside the matcher, but they do not impose a wall-clock deadline on the surrounding application. Use a worker or separate process when you need an execution deadline.

The matcher accepts only Unicode scalar values. Lone surrogates in patterns or subjects are rejected.

## Reporting a vulnerability

Do not open a public GitHub issue for a security vulnerability.

Use [GitHub's private vulnerability form](https://github.com/robinvdvleuten/treffer/security/advisories/new).

Include the affected code, its impact, and steps that reproduce the issue. Tell us whether and how to credit you.

We do not accept AI slop reports.

Keep the report private while we investigate and prepare a fix.
