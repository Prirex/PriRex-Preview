# Security Policy

## Supported Versions

Security fixes are shipped for the latest published release line only.

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | :white_check_mark: |
| < 2.0   | :x:                |

## Reporting a Vulnerability

Please **do not** open a public issue for security problems.

Report privately via **GitHub Security Advisories**:
<https://github.com/Prirex/PriRex-Preview/security/advisories/new>

That channel is private between you and the maintainer, so no public issue is created.
If you cannot use GitHub, open a regular issue containing **no exploit details** and ask for a
private channel — the report will be moved to an advisory.

Please include:

- affected version (`package.json` → `version`),
- operating system and Node.js version,
- a minimal reproduction (HTML/JS snippet, request, or protocol message),
- the impact you expect (local file read, RCE, data exfiltration, DoS, …).

## What to Expect

| Stage                              | Target                    |
| ---------------------------------- | ------------------------- |
| Acknowledgement of the report       | within 72 hours           |
| Initial assessment / triage         | within 7 days             |
| Fix or mitigation plan              | within 30 days            |
| Public disclosure                   | coordinated with reporter |

You will be credited in the release notes unless you ask to stay anonymous.

## Threat Model and Scope

PriRex Preview is a **local-only developer tool**: it runs inside DeepSeek Harness,
starts an HTTP server bound to `127.0.0.1` on an ephemeral port, and a WebSocket hub
on `127.0.0.1:3099` (overridable via `PRIREX_HUB_PORT`). It performs no telemetry and
makes no outbound network calls of its own. In Node.js mode it spawns the project's own
`dev`/`start` script after you explicitly pick that project's folder (auto-start) or press
**Start Node.js server**, and proxies the dev server through a second `127.0.0.1` server.

Browser connections to the hub are accepted only from `http://127.0.0.1:*`,
`http://localhost:*`, `http://[::1]:*`, the DSH Desktop application origin
`dsh-app://app` (and `shell`), `file:`/opaque desktop documents, or origins listed in
`PRIREX_ALLOWED_ORIGINS`; requests without an `Origin` header (local CLI, tests) are allowed
because such a client already runs with the user's privileges.

In scope:

- path traversal or arbitrary file read through the static file server,
- injection of attacker-controlled markup/scripts into served pages beyond the
  documented inspector payload,
- unauthenticated WebSocket hub messages that can be abused by another local process
  or a malicious page to read or write data outside the selected project folder,
- drive-by pages using the hub to start a project script or read files,
- denial of service against the host process (unbounded memory/CPU growth).

Out of scope:

- vulnerabilities in the DeepSeek Harness host application itself,
- code executed by the project's own npm/dev script — it runs with your privileges by
  design once you pick its folder or press **Start Node.js server**,
- the dev server binding to `0.0.0.0` or other interfaces on its own,
- issues that require the attacker to already have local code execution with the
  same user privileges,
- the fact that the local preview server is reachable by other processes or pages
  on the same machine (that is by design for web development),
- third-party dependencies (`ws`, `chokidar`) — report those upstream, though we
  will still ship version bumps.

## Hardening Recommendations

- Only point the preview server at folders you own or trust: selecting a folder with a Node.js
  project auto-starts its `dev`/`start` script with your rights.
- Do not expose ports `3099` or the ephemeral preview ports to public networks.
- Set `PRIREX_ALLOWED_ORIGINS` only when you deliberately serve the DSH UI from a non-local
  origin.
- Keep dependencies current: `npm audit` / `npm outdated`.
