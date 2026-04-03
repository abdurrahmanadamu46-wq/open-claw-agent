import sqlite3
from pathlib import Path
from agent_rag_pack_factory import ensure_schema, list_targets, _fallback_pack, upsert_pack

def collect_tenants():
    tenants = {
        'tenant_demo','tenant-main','tenant-a','tenant-b','tenant-c',
        'tenant_beauty','tenant_hotel','tenant_food','tenant_local',
    }
    db_candidates = [
        Path('/app/dragon_auth.db'),
        Path('/app/dragon_billing.db'),
        Path('/app/data/industry_kb.sqlite'),
        Path('/app/data/industry_profiles.sqlite'),
        Path('/app/data/tenant_profiles.sqlite'),
        Path('/app/data/research_radar.sqlite'),
    ]
    for p in db_candidates:
        if not p.exists():
            continue
        try:
            conn = sqlite3.connect(str(p))
            conn.row_factory = sqlite3.Row
            tables = [r['name'] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
            for t in tables:
                cols = [c[1] for c in conn.execute(f"PRAGMA table_info({t})").fetchall()]
                if 'tenant_id' in cols:
                    for r in conn.execute(f"SELECT DISTINCT tenant_id FROM {t} WHERE tenant_id IS NOT NULL").fetchall():
                        v = str(r[0]).strip()
                        if v:
                            tenants.add(v)
            conn.close()
        except Exception:
            pass
    return sorted(tenants)

def seed_for_tenant(tenant_id):
    targets = list_targets('feedback')
    cnt = 0
    for target in targets:
        pack = _fallback_pack(target)
        upsert_pack(
            tenant_id=tenant_id,
            profile=target.profile,
            agent_id=target.agent_id,
            knowledge_pack_id=target.knowledge_pack_id,
            knowledge_pack_name=target.knowledge_pack_name,
            payload=pack,
            model_name='fallback_seed',
            trace_id='seed_bulk_multi_tenant',
            fallback_used=True,
            updated_by='codex_seed',
        )
        cnt += 1
    return cnt

ensure_schema()
tenants = collect_tenants()
res = {}
for tid in tenants:
    try:
        res[tid] = seed_for_tenant(tid)
    except Exception as e:
        res[tid] = f'ERR:{e}'
print({'tenants': tenants, 'result': res})
