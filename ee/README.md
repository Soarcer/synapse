# Synapse Enterprise (`/ee`)

This directory contains **Synapse Enterprise** features, licensed separately from the open-source core.

## License

Code in this directory is licensed under the [Synapse Enterprise License](LICENSE), **not** the AGPL-3.0 license that covers the rest of the project.

**You may** freely view, modify, and test this code in non-production environments.

**Production use** requires a valid Synapse Enterprise subscription.

## What's in `/ee`?

Enterprise features solve problems that appear when teams and organizations adopt AI agents at scale:

- **Team dashboards** — shared views across multiple developers
- **Cross-project aggregation** — unified metrics across repositories
- **Advanced analytics** — executive overview, prompt analysis, scheduled reports
- **AI coaching engine** — report cards, playbooks, cross-session trend analysis
- **Budget management** — spending caps, graduated alerts, team-level budgets
- **Integrations** — Slack, webhook, CI/CD pipeline triggers
- **Compliance** — SSO/SAML, RBAC, audit logging
- **Multi-vendor monitoring** — OpenClaw adapters for Anthropic, OpenAI, Google, Groq

## Relationship to Open-Source Core

The open-source core (everything outside `/ee`) is a **complete, standalone product** for individual developers. It includes the full interactive graph, all 6 lens views, real-time coaching nudges, cost tracking, the VS Code extension, and agent spawning.

Enterprise features are additive — they extend the core without limiting it.

## Contributing to `/ee`

Contributions to enterprise features are welcome. Please note that by contributing code to this directory, you agree that your contributions will be licensed under the Synapse Enterprise License (see [LICENSE](LICENSE)), not the AGPL-3.0.

See the root [CONTRIBUTING.md](../CONTRIBUTING.md) for development setup and guidelines.

## Getting a License

For enterprise licensing inquiries, contact: synapse-enterprise@example.com
