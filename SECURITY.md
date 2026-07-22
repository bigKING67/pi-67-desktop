# Security Policy

## Supported versions

No public version is supported yet. Security reports should target the current
`main` source and identify the exact commit.

## Sensitive data boundary

The application must not log, store in SQLite, include in support bundles, or
send remotely:

- API keys or OAuth tokens
- cookies or credential payloads
- prompt/source bodies by default
- raw tool payloads by default
- unrelated files outside the selected workspace

The real Pi installation owns auth and session persistence. Desktop consumes
redacted status and official Pi storage/control APIs through a local helper.

The Desktop-only safety extension canonicalizes direct file-tool paths. Shell
commands that cannot be proven safe by the narrow policy require one-shot
approval. HTTP/HTTPS transcript links also display the exact target and require
one-shot approval before the system browser opens.

## Reporting

Do not open a public issue containing credentials, private prompts, source
code, or session data. Use the repository owner's private security reporting
channel after it is enabled.
