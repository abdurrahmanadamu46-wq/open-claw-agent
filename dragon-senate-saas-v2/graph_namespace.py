"""
Graph namespace helpers inspired by graphiti namespaces.
"""

from __future__ import annotations


class GraphNamespace:
    @staticmethod
    def tenant_ns(tenant_id: str) -> str:
        return f"ns:tenant:{str(tenant_id or '').strip()}"

    @staticmethod
    def lead_ns(tenant_id: str, lead_id: str) -> str:
        return f"{GraphNamespace.tenant_ns(tenant_id)}:lead:{str(lead_id or '').strip()}"

    @staticmethod
    def validate(namespace: str, tenant_id: str) -> bool:
        return str(namespace or "").startswith(GraphNamespace.tenant_ns(tenant_id))
