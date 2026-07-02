# Security Policy

## Reporting a Vulnerability

Please report security issues privately to nishantunavane0007@gmail.com rather than
opening a public issue. We'll acknowledge within 48 hours.

## Known Security Model

- **API keys** are stored encrypted at rest using AES-256-GCM in `~/.pi/agent/.vault/`.
- **Social media credentials** are stored as browser cookies in `~/.pi/agent/.playwright/` — never transmitted.
- **Email auth** supports both OAuth 2.0 Device Flow and Gmail App Passwords (SMTP). Tokens are vault-encrypted.
- **SSH keys** are never stored on disk — read via `ssh-agent` or prompted per-session.
- **Plugin sandboxing**: plugins run with restricted API access (no `child_process`, no `fs`, no `net`) and a 5-second timeout.
- **Approval gates** — destructive actions (file deletion, social posting, email, deployments) always require user confirmation.
