# Same-repo Subprojects

This folder defines top-level subprojects that live inside the main repository.

Rule:

- One subproject = one clear ownership boundary.
- A subproject may depend on many engineering subdomains.
- A subproject does not automatically own every downstream service or runtime that it calls.
- Ownership is defined by scope, not by repository size.

Current top-level subprojects:

1. `cloud-brain-senate-core`
   - Scope: `Commander + 9 lobster elders`
   - Nature: cloud brain role system
   - Position: business intelligence and orchestration layer
