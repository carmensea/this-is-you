# Contributing

## Fictional data only

This project handles medical records, so every contribution uses invented data. Never put any of these in an issue, pull request, discussion, commit, test, fixture, example or screenshot:

- real medical records, lab reports, PDFs or values, even with names removed,
- screenshots or screen recordings of an archive holding real records,
- logs, error output or browser captures (`.har`) from a real archive,
- databases, backups, exports or anything from an archive folder,
- passphrases, session cookies, OAuth tokens, client IDs, client secrets, private keys or Tailscale keys,
- anything that identifies a patient, a person or their healthcare provider.

Use the fictional patterns already in the code instead: `backend/tests/pdfs.py` builds fictional PDFs while tests run, the demo archive in `src/data/` is invented, and names like "Avery Testperson" are made up. When reporting a problem with a real document, describe its layout ("one cell per line, values like `0-2 /HPF`") and reproduce it with invented values.

If real data is shared by mistake, say so to the maintainer at once and do not try to fix it with a new commit: removing it from history needs care. Security problems go through `SECURITY.md`, never a public issue.

## The Git hooks

Turn them on once per clone:

```
git config core.hooksPath .githooks
```

- `pre-commit` checks what is staged, and `pre-push` checks every file in every commit, using `tools/check-no-records.py`.
- They refuse PDFs, databases, backups, binary files, archive folders, environment files, keys and certificates, browser captures, bulk exports, and text that looks like a private key or a token. Only the file name and the rule are printed, never the contents.
- `git commit --no-verify` skips them. They stop accidents, not someone determined, so please do not skip them.
- The service itself refuses to keep an archive or backups inside a Git repository.

## Checks on every pull request

`.github/workflows/checks.yml` runs the same record guard over every file in every commit, gitleaks over the whole history including merges, and the tests and type check. It runs with read-only access and no secrets, also for pull requests from forks. A pull request that fails it is not merged.

## Tests

`npm test`, `npm run test:backend` and `npm run typecheck` must pass. A change to how records are read, stored or reviewed needs a test that uses fictional data.
