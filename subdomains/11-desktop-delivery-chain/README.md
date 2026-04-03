# Desktop Delivery Chain

Thread: `sd-11`

Existing source anchor:

- [apps/desktop-client/README.md](/F:/openclaw-agent/apps/desktop-client/README.md)

## 1. Boundary & Contract

Protocol:

- Update manifest: REST
- Artifact fetch: object storage or CDN

Input example:

```json
{
  "schema_version": "desktop.update.request.v1",
  "platform": "win-x64",
  "channel": "stable",
  "current_version": "0.9.1"
}
```

Output example:

```json
{
  "schema_version": "desktop.update.result.v1",
  "status": "success",
  "update_available": true,
  "manifest": {
    "version": "0.9.2",
    "artifact_url": "https://cdn.example.com/runtime.zip",
    "sha256": "abc123"
  }
}
```

## 2. Core Responsibilities

- Publish manifests
- Verify signature and checksum
- Deliver runtime updates
- Maintain channel and rollout strategy

## 3. Fallback & Mock

- If manifest service is unavailable, return `no_update`
- If signature fails, block update but keep client usable

## 4. Independent Storage & Dependencies

- Dedicated manifest registry
- Dedicated artifact storage
- Dedicated signing key management

## 5. Evolution Path

- Full-package updates
- Delta updates
- Channel-aware staged rollout
