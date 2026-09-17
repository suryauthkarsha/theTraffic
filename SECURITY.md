# Security policy

## Supported version

The latest commit on `main` is the supported version. This project does not currently maintain older release branches.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability or suspected secret exposure.

Use [GitHub's private vulnerability reporting](https://github.com/suryauthkarsha/theTraffic/security/advisories/new) to share:

- the affected route, file, or commit;
- steps to reproduce;
- the likely impact;
- any suggested mitigation;
- whether the problem is already being exploited.

You should receive an acknowledgement within seven days. Please allow time to investigate and publish a fix before disclosing the report publicly.

## In scope

Reports about the web app, grievance Worker, build pipeline, repository automation, data ingestion, authentication assumptions, privacy boundaries, upload validation, origin controls, or accidental credential exposure are welcome.

For vulnerabilities in a third-party service or dependency, report the issue upstream as well. Do not test against real users, submit harmful grievance content, access data you do not own, or degrade the public service.

## Security design

The repository includes regression tests for credential patterns, environment-file exclusions, Content Security Policy, outbound links, Worker headers, named-origin CORS, upload limits, JPEG metadata removal, rate limiting, and moderator-passphrase handling. See `web/src/test/security.test.ts` and `docs/DEPLOYMENT.md`.

Automation is pinned and watched: every GitHub Action is referenced by commit, workflows run with read-only repository permissions and no secrets, Dependabot proposes dependency updates for every manifest (`.github/dependabot.yml`), and CodeQL scans the TypeScript, Python and workflow code (`.github/workflows/codeql.yml`). The same test fails if any of that loosens. Secret-scanning push protection, Dependabot alerts and branch protection are repository settings the maintainer keeps on (`docs/DEPLOYMENT.md`, "Repository settings").
