# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use [GitHub Private Vulnerability Reporting](https://github.com/DockCat/miwifi-webui/security/advisories/new) to submit your report confidentially.

When reporting, please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (or a proof of concept if possible)
- Affected version(s), if known

We will acknowledge receipt within **72 hours** and aim to provide a fix or mitigation plan within **14 days** of a confirmed vulnerability.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

## Security Measures

This project employs automated security scanning as part of its CI pipeline:

- **CodeQL** — static analysis for JavaScript/TypeScript
- **Dependency Review** — new dependency vulnerability checks on pull requests
- **Trivy** — filesystem vulnerability scan and IaC/configuration audit
- **Zizmor** — GitHub Actions workflow security analysis
- **Dependabot** — automated dependency and security updates
- **GitHub Secret Scanning + Push Protection** — credential leak prevention

## Scope

Security reports are welcome for:

- The `miwifi-webui` application code (frontend and backend)
- Docker/Compose deployment configuration
- CI/CD workflow security
- Authentication and session management
- Router credential handling

Out of scope:

- Vulnerabilities in upstream Xiaomi/MiWiFi router firmware
- Third-party services not maintained by this project
