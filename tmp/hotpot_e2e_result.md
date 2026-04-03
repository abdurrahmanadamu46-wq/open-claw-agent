# ???????

???? ??

- ? healthz
  - status=200
- ? auth/login
- ? industry-kb/dissect-and-ingest
  - `{"trace_id": "6f181130-99dc-4169-a67a-e37199b9d778", "industry_tag": "restaurant_hotpot", "ingested": 2, "rejected": 0, "duplicate": 4}`
- ? run-dragon-team
  - `{"request_id": "5045028f-9d3d-453a-b09b-23a8fd9e9984", "trace_id": "5045028f-9d3d-453a-b09b-23a8fd9e9984", "industry_tag": "restaurant_hotpot", "industry_kb_context_count": 6, "publish_allowed": true, "hitl_required": true, "reason_codes": ["guardian.allow", "verification.pass"]}`
- ? receive_dm_from_edge
  - `{"intent": null, "lead_score": null, "followup_status": null, "trace_id": "dm_edge-hotpot-001_1774205639"}`
- ? followup/spawns/recent
  - `{"items": 0}`
- ? kernel/report
  - `{"publish_allowed": null, "confidence_band": null, "reason_codes": []}`
- ? memory/trace
  - `{"events": 0}`