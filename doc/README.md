# Documentation

These guides describe the checked-in implementation, reviewed on 30 October 2026. They do not assert the current deployed version, provider availability, dependency-audit result, or a fresh production verification.

## Development

- [Setup and validation](development/setup.md): install, run, migrate local D1, test and navigate the repository.

## Architecture

- [Data flow and persistence](architecture/overview.md): rendering, discovery, ranking, clustering, coverage and caching.
- [Security and local state](architecture/security.md): quotas, request/content boundaries, saved stories and offline caching.

## Reference

- [Configuration](reference/configuration.md): server environment variables and operator-only configuration.
- [News API](reference/news-api.md): query parameters, continuation and response semantics.
- [Providers and content policy](reference/providers.md): adapters, publisher identity, RSS configuration and content restrictions.

## Operations

- [Ingestion](operations/ingestion.md): schedules, authentication, retries, outcomes and troubleshooting.
- [Deployment and rollback](operations/deployment.md): migration order, release verification and rollback compatibility.

## Design

- [Interface system](design/interface.md): theme, effective tokens, typography, controls and review checklist.
- [Publisher artwork](design/publisher-marks.md): asset provenance and fallback behavior.

## Keeping the guides current

Update the relevant guide alongside code, workflow or configuration changes. Keep the root README as an introduction and link detailed behavior here. Use source links for implementation contracts; record a date and revision for any measured result. Test counts, old audit results and old Site versions are not current acceptance evidence.

Superseded optimization and ingestion audit reports were removed; their original measurements and release history remain in Git. Current behavior and useful operating guidance are consolidated above. Agent instructions stay in the root [CLAUDE.md](../CLAUDE.md), and the vendored [braces README](../vendor/braces/README.md) and licenses stay with their source/assets for provenance.
