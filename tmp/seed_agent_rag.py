from agent_rag_pack_factory import ensure_schema, list_targets, _fallback_pack, upsert_pack

tenant_id='tenant_demo'
profile='feedback'
ensure_schema()
targets=list_targets(profile)
count=0
for t in targets:
    pack=_fallback_pack(t)
    upsert_pack(
        tenant_id=tenant_id,
        profile=t.profile,
        agent_id=t.agent_id,
        knowledge_pack_id=t.knowledge_pack_id,
        knowledge_pack_name=t.knowledge_pack_name,
        payload=pack,
        model_name='fallback_seed',
        trace_id='seed_fallback_90',
        fallback_used=True,
        updated_by='codex_seed',
    )
    count += 1
print({'seeded': count, 'tenant_id': tenant_id, 'profile': profile})
