# Sub-domain Isolation Layer

This folder is the isolation layer for sub-project execution inside the same repository.

Principles:

1. Contract-driven
   - Parent systems and subdomains must communicate only through strict contracts.
   - Contracts are defined by JSON request/response examples and thread manifests.
   - Database tables, in-memory state, and implementation details must not be shared across boundaries.

2. Black-box evolution
   - Each subdomain may change its internal stack, runtime, model provider, and release cadence.
   - As long as it keeps the same external contract, the parent system should not care how it is implemented.

3. Same-repo multi-thread isolation
   - All subdomains live in the same repository.
   - Each subdomain is owned by an independent execution thread.
   - Each subdomain has its own folder and `THREAD.json` manifest.
   - "Physical isolation" here means directory boundary + contract boundary + ownership boundary.
   - It does not mean separate git repositories by default.

4. Default dependency rule
   - No direct database sharing with the main control plane.
   - No shared mutable memory with the main control plane.
   - Communication allowed only by REST, gRPC, Webhook, or MQ event contracts.

5. Thread ownership rule
   - One subdomain == one owner thread.
   - A thread may change only files inside its own subdomain boundary, shared contracts, or explicitly assigned integration surfaces.
   - Cross-subdomain calls must go through contract files, API clients, webhooks, or MQ topics.

Subdomains in this layer:

1. `01-async-mission-orchestrator`
2. `02-research-radar-batch`
3. `03-industry-compiler`
4. `04-memory-compiler`
5. `05-video-factory`
6. `06-telegram-command-gateway`
7. `07-policy-router`
8. `08-cti-engine`
9. `09-trust-verification`
10. `10-xai-scorer`
11. `11-desktop-delivery-chain`
12. `12-superharbor-command-cabin`
13. `13-liaoyuan-os-runtime-lab`

Canonical registry:

- [registry.json](/F:/openclaw-agent/subdomains/registry.json)
