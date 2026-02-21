# Governance

## Overview

Synapse is an open-source agent monitoring dashboard that provides real-time observability into AI agent orchestration. The core project is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

The project is currently maintained by its creator. As the community grows, governance will evolve to reflect the people who invest their time and expertise in making Synapse better.

## Decision Making

Synapse currently operates under a **single-maintainer** model. As the community grows, we intend to adopt **lazy consensus** for non-controversial changes:

- **Lazy consensus** — a proposed change is accepted if no one objects within a reasonable timeframe (typically 72 hours for significant changes). Silence is agreement.
- **Explicit consensus** — for architectural changes, license modifications, or changes to governance itself, explicit approval from the maintainer is required.
- **Maintainer authority** — the maintainer has final say on architecture, roadmap, and release decisions. This authority is exercised transparently, with reasoning communicated publicly.

The goal is to move toward a broader set of decision-makers as trusted contributors emerge.

## Roles

### Maintainer

- Full commit access to all repositories
- Release authority (versioning, publishing, changelog)
- Final say on architecture and roadmap direction
- Responsible for enforcing the Code of Conduct
- Reviews and merges pull requests

### Contributor

- Submit pull requests for review
- Participate in design discussions via issues and PRs
- Report bugs and suggest features
- Contributions are reviewed by a maintainer before merging

Active contributors who demonstrate consistent, high-quality contributions may be invited to take on expanded roles as the project grows.

### Community

- File issues and bug reports
- Participate in GitHub Discussions
- Provide feedback on proposed features and changes
- Help other users with setup and usage questions

## Commercial Relationship

Transparency matters. Here is the relationship between the open-source project and its commercial layer:

- Synapse has **enterprise features** in the [`/ee`](ee/) directory, licensed under the [Synapse Enterprise License](ee/LICENSE).
- The open-source core will **never** be relicensed or made proprietary. This is a commitment, not a marketing line.
- The free, open-source tier is a **complete, standalone product** for individual developers. It does everything described in the README without any paid features.
- Enterprise features are **additive, not restrictive** — they add capabilities for teams and organizations (audit logs, SSO, advanced analytics) but never remove or gate existing open-source functionality.
- Revenue from enterprise features funds continued development of the open-source core.

If you have questions about where the boundary falls between open-source and enterprise, see the [Contributing Guide](CONTRIBUTING.md#the-ee-boundary).

## Roadmap

The project roadmap lives at [docs/ROADMAP.md](docs/ROADMAP.md).

Community input on the roadmap is welcome via:
- **GitHub Discussions** — for open-ended ideas and conversations
- **GitHub Issues** — for concrete feature requests and bug reports

Roadmap priorities are influenced by community feedback, contributor interest, and the project's long-term vision.

## Code of Conduct

All participants in the Synapse community are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md). Please report unacceptable behavior to synapse-conduct@example.com.
