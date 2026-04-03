from __future__ import annotations

import importlib
import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _fail(msg: str) -> None:
    print(f"[CONTRACTS][FAIL] {msg}")
    raise SystemExit(1)


def _ensure_dependencies() -> None:
    required = [
        ("yaml", "pyyaml"),
        ("jsonschema", "jsonschema"),
        ("openapi_spec_validator", "openapi-spec-validator"),
    ]
    missing: list[str] = []
    for module_name, package_name in required:
        try:
            importlib.import_module(module_name)
        except ModuleNotFoundError:
            missing.append(package_name)

    if not missing:
        return

    if os.getenv("CONTRACTS_AUTO_INSTALL", "1").lower() in {"0", "false", "no"}:
        _fail(
            "missing dependencies: "
            + ", ".join(missing)
            + " (run: python -m pip install " + " ".join(missing) + ")"
        )

    print(f"[CONTRACTS] missing dependencies detected, auto-installing: {', '.join(missing)}")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", *missing])
    except Exception as exc:  # noqa: BLE001
        _fail(f"failed to install contract dependencies ({missing}): {exc}")


_ensure_dependencies()

import yaml  # noqa: E402
from jsonschema import Draft202012Validator  # noqa: E402
from openapi_spec_validator import validate_spec  # noqa: E402


def _load_json(path: Path) -> dict:
    try:
        # Use utf-8-sig to tolerate BOM in legacy files while we gradually clean encoding.
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception as exc:  # noqa: BLE001
        _fail(f"invalid json: {path} -> {exc}")


def _load_yaml(path: Path) -> dict:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8-sig"))
        return raw if isinstance(raw, dict) else {}
    except Exception as exc:  # noqa: BLE001
        _fail(f"invalid yaml: {path} -> {exc}")


def validate_openapi() -> None:
    path = ROOT / "packages" / "contracts" / "openapi" / "control-plane.openapi.yaml"
    if not path.exists():
        _fail(f"missing openapi file: {path}")

    spec = _load_yaml(path)
    try:
        validate_spec(spec)
    except Exception as exc:  # noqa: BLE001
        _fail(f"openapi validation failed: {exc}")

    required_paths = {
        "/api/v1/ai/run-dragon-team",
        "/api/v1/ai/analyze-competitor-formula",
        "/api/v1/autopilot/dlq/list",
        "/api/v1/autopilot/dlq/replay",
        "/api/v1/autopilot/trace/{traceId}",
    }
    got_paths = set((spec.get("paths") or {}).keys())
    missing = sorted(required_paths - got_paths)
    if missing:
        _fail(f"openapi missing required paths: {missing}")

    print(f"[CONTRACTS][OK] OpenAPI validated: {path}")


def validate_json_schemas() -> None:
    schema_dirs = [
        ROOT / "packages" / "contracts" / "events",
        ROOT / "packages" / "contracts" / "dto",
        ROOT / "packages" / "observability" / "logging",
    ]

    validated = 0
    for schema_dir in schema_dirs:
        if not schema_dir.exists():
            _fail(f"schema dir missing: {schema_dir}")
        for path in sorted(schema_dir.glob("*.json")):
            payload = _load_json(path)
            try:
                Draft202012Validator.check_schema(payload)
            except Exception as exc:  # noqa: BLE001
                _fail(f"invalid json schema {path}: {exc}")
            validated += 1
            print(f"[CONTRACTS][OK] JSON Schema valid: {path}")

    if validated == 0:
        _fail("no json schemas validated")


def validate_observability_rules() -> None:
    rules_path = ROOT / "packages" / "observability" / "alerts" / "rules.v1.yaml"
    if not rules_path.exists():
        _fail(f"missing alert rules file: {rules_path}")

    rules_doc = _load_yaml(rules_path)
    rules = rules_doc.get("rules")
    if not isinstance(rules, list) or not rules:
        _fail("alerts rules must be a non-empty list")

    severities = {"P1", "P2", "P3"}
    for idx, item in enumerate(rules, start=1):
        if not isinstance(item, dict):
            _fail(f"alert rule #{idx} must be object")
        for key in ("id", "severity", "metric", "threshold", "window", "route"):
            if key not in item:
                _fail(f"alert rule #{idx} missing field: {key}")
        if item["severity"] not in severities:
            _fail(f"alert rule #{idx} invalid severity: {item['severity']}")
        if not isinstance(item["route"], list) or not item["route"]:
            _fail(f"alert rule #{idx} route must be non-empty list")

    suppress = rules_doc.get("suppress_windows")
    if not isinstance(suppress, dict):
        _fail("suppress_windows must be object")
    for sev in severities:
        if sev not in suppress:
            _fail(f"suppress_windows missing severity key: {sev}")

    print(f"[CONTRACTS][OK] observability alert rules validated: {rules_path}")


def validate_log_schema_required_fields() -> None:
    path = ROOT / "packages" / "observability" / "logging" / "structured-log.schema.json"
    schema = _load_json(path)
    required = set(schema.get("required") or [])
    for field in ("ts", "level", "service", "eventType", "traceId", "tenantId"):
        if field not in required:
            _fail(f"structured log schema required fields missing: {field}")

    print(f"[CONTRACTS][OK] structured log required fields validated: {path}")


def main() -> int:
    validate_openapi()
    validate_json_schemas()
    validate_log_schema_required_fields()
    validate_observability_rules()
    print("[CONTRACTS][PASS] all contract validations passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
