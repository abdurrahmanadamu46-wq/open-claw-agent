# Video Factory

Thread: `sd-05`

Existing source anchor:

- [dragon-senate-saas-v2/README.md](/F:/openclaw-agent/dragon-senate-saas-v2/README.md)

## 1. Boundary & Contract

Protocol:

- Submit render: async REST job
- Status query: REST
- Finish notify: Webhook

Input example:

```json
{
  "schema_version": "video.factory.request.v1",
  "trace_id": "trace_vf_001",
  "tenant_id": "tenant_demo",
  "industry_tag": "hotel",
  "script_pack": {
    "storyboard_count": 5,
    "scenes": [
      {
        "scene": 1,
        "copy": "Open with a trust-building hook"
      }
    ]
  },
  "render_policy": {
    "provider_order": ["comfyui-local", "libtv"],
    "digital_human_mode": false
  }
}
```

Output example:

```json
{
  "schema_version": "video.factory.result.v1",
  "status": "success",
  "job_id": "vf_001",
  "media_pack": [
    {
      "scene": 1,
      "url": "https://cdn.example.com/vf_001_scene1.mp4",
      "type": "video"
    }
  ],
  "engine_selected": "comfyui-local",
  "post_plan": {
    "subtitle": true,
    "auto_cut": true
  }
}
```

## 2. Core Responsibilities

- Render or generate image/video assets
- Choose local or cloud provider
- Package scene outputs and media URLs
- Provide post-production suggestions

## 3. Fallback & Mock

- If local ComfyUI fails, fall back to LibTV
- If all rendering fails, return prompt-only pack
- Parent system continues with strategy/copy even without media URLs

## 4. Independent Storage & Dependencies

- Dedicated render queue
- Object storage for media outputs
- Local GPU runtime or cloud rendering API

## 5. Evolution Path

- Cloud-first rendering
- Local-first GPU routing
- Asset reuse, caching, and low-cost rerender
