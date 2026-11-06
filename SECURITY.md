# Security

This Is You keeps a person's medical records on their own computer. A weakness here can expose someone's health history, so reports are welcome and taken seriously.

## Reporting a vulnerability

Report privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability**. Only the maintainer sees the report.

Please do not open a public issue, pull request or discussion about a vulnerability, and do not include real medical records, real screenshots, tokens, passphrases or credentials in a report. Describe the problem with fictional data, as the project's own tests do.

Useful in a report:
- what an attacker needs (on the same computer, on the same network or tailnet, or a website the user visits),
- what they can read or change,
- steps to reproduce with a fictional archive (`THIS_IS_YOU_DATA_DIR` pointing at an empty folder),
- the version or commit.

You can expect an acknowledgement within 7 days. This is a one-person project, so a fix may take longer; you will be told what is planned. Please allow up to 90 days, or until a fix is released, before disclosing publicly.

## Scope

In scope: the service in `backend/`, the app in `src/`, the deployment files in `deploy/`, `Dockerfile` and `compose.yaml`, and the tools in `tools/`.

Out of scope: weaknesses that need the attacker to already control the user's account or operating system, and problems in third-party services such as Tailscale or a healthcare provider's systems (report those to them).

## What the design promises

`docs/threat-model.md` lists who can reach the service, what each check defends against, and what is deliberately not defended. A report showing that one of its "defended" claims does not hold is exactly what this policy is for.
