from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from edge_resource_governor import can_use_resource
from edge_resource_governor import end_lease
from edge_resource_governor import ensure_schema
from edge_resource_governor import revoke_consent
from edge_resource_governor import start_lease
from edge_resource_governor import summary
from edge_resource_governor import upsert_consent


def main() -> None:
    suffix = uuid.uuid4().hex[:8]
    db_path = os.path.abspath(f"./_test_edge_resource_governor_{suffix}.sqlite")
    os.environ["EDGE_RESOURCE_DB_PATH"] = db_path

    ensure_schema()
    consent = upsert_consent(
        edge_id="edge-001",
        user_id="u1",
        tenant_id="tenant_demo",
        consent_version="v2",
        accepted=True,
        ip_share_enabled=True,
        compute_share_enabled=False,
        otp_relay_enabled=True,
        operator="u1",
        notes="bootstrap-test",
    )
    assert consent["status"] == "active"

    ok_ip, reason_ip, _ = can_use_resource("edge-001", "ip_proxy")
    ok_compute, reason_compute, _ = can_use_resource("edge-001", "compute")
    assert ok_ip is True and reason_ip == "ok"
    assert ok_compute is False and reason_compute == "compute_share_disabled"

    lease_ip = start_lease(
        edge_id="edge-001",
        user_id="u1",
        tenant_id="tenant_demo",
        resource_type="ip_proxy",
        purpose_code="radar_fetch",
        requester="dispatcher",
        approved_by="hitl:ok",
        trace_id="trace_x",
        task_id="task_x",
        metadata={"campaign": "c1"},
    )
    assert lease_ip["ok"] is True
    lease_id = lease_ip["lease"]["lease_id"]

    ended = end_lease(lease_id=lease_id, status="ended", reason="done", operator="dispatcher")
    assert ended["ok"] is True
    assert ended["lease"]["status"] == "ended"

    lease_compute = start_lease(
        edge_id="edge-001",
        user_id="u1",
        tenant_id="tenant_demo",
        resource_type="compute",
        purpose_code="light_infer",
        requester="dispatcher",
    )
    assert lease_compute["ok"] is False
    assert lease_compute["reason"] == "compute_share_disabled"

    revoked = revoke_consent(edge_id="edge-001", operator="u1", reason="manual-stop")
    assert revoked["ok"] is True
    assert revoked["consent"]["status"] == "revoked"

    lease_after_revoke = start_lease(
        edge_id="edge-001",
        user_id="u1",
        tenant_id="tenant_demo",
        resource_type="ip_proxy",
        purpose_code="dispatch",
    )
    assert lease_after_revoke["ok"] is False
    assert lease_after_revoke["reason"] == "consent_not_active"

    digest = summary(tenant_id="tenant_demo", user_id="u1")
    assert digest["lease_total"] >= 3
    assert digest["lease_ended_total"] >= 1
    assert digest["lease_denied_total"] >= 1
    assert digest["active_nodes"] == 0
    assert digest["revoked_nodes"] >= 1

    print(
        json.dumps(
            {
                "ok": True,
                "db_path": db_path,
                "summary": digest,
                "latest_lease_denied_reason": lease_after_revoke["reason"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
