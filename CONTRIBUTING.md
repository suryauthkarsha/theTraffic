# Contributing to theTraffic.

Thanks for helping make Bengaluru's road data easier to inspect and challenge.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- Use a discussion issue before beginning a large architectural or dataset change.
- Never commit credentials, private endpoints, personal contact details, raw location traces, or unlicensed source material.
- Read [DATA_LICENSES.md](DATA_LICENSES.md) before changing a dataset.
- Report security problems privately as described in [SECURITY.md](SECURITY.md).

## Development setup

Prerequisites: Bun 1.4.2 and Node.js 22 or newer. Python 3.11 or newer is needed only for the ingestion pipeline.

```bash
git clone https://github.com/suryauthkarsha/theTraffic.git
cd theTraffic
(cd web && bun install --frozen-lockfile && bun run dev)
```

The site runs at <http://localhost:8080>. It needs no credentials. Optional environment settings are documented in `.env.example`.

## Making a change

1. Fork the repository and create a focused branch from `main`.
2. Keep the change small enough to review.
3. Add or update tests for behaviour changes.
4. Update documentation when a command, schema, data source, claim, or privacy property changes.
5. Open a pull request using the template and link any related issue.

Please use clear commit messages such as `fix: preserve map filters on back navigation` or `data: correct junction source link`.

## Required checks

Run the checks that apply to your change:

```bash
# Run these from the repository root
(cd web && bun run lint && bun run typecheck && bun run test && bun run build)
bun test functions/tests scripts/tests
(cd functions && npm ci && npm run typecheck && npm run build)

# Python ingestion pipeline
python3 -m pip install -r requirements-dev.txt
python3 -m unittest discover -s scripts/tests -v
```

A web build must pass with an empty environment. Do not weaken the secret scanner, Content Security Policy, origin allow-list, upload limits, or privacy tests to make a change pass.

## Data contributions

A data correction must include:

- the affected dataset and stable record ID;
- a public source URL or reproducible source file;
- the source publisher, licence or reuse terms, retrieval date, and observation date when known;
- a short explanation of the transformation;
- updated metadata and tests where the schema or count changes.

Additional rules:

- Do not scrape private or unauthorised traffic feeds.
- Do not describe an intersection as untimed merely because this project has no plan for it.
- Do not infer that a surveillance record is active, monitored, police-owned, or capable of facial recognition.
- Never add personal movement traces or identifying grievance data.
- Parsed timing plans remain unverified until a reviewer explicitly records a decision in `review_decisions.v1.json`.

## Code style

- Use TypeScript for web and Worker code.
- Prefer small pure functions and tests for data or modelling rules.
- Preserve keyboard access, reduced-motion support, phone layouts, and visible focus states.
- Keep user-facing claims short, sourced, and explicit about uncertainty.
- Avoid adding a dependency when the same result is clear with platform APIs or existing packages.

## Pull-request review

Maintainers may ask for smaller scope, stronger provenance, added tests, or more conservative wording. A contribution can be technically correct and still be declined if it weakens privacy, creates an unsupported claim, or cannot be maintained responsibly.

By contributing, you agree that your contribution is licensed under the repository's MIT License. Third-party data remains subject to its own terms.
