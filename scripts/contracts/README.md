# Contracts Validation

Run local validation:

```powershell
python scripts/contracts/validate_contracts.py
```

默认会自动补齐依赖（`pyyaml/jsonschema/openapi-spec-validator`）。
如需禁用自动安装：设置 `CONTRACTS_AUTO_INSTALL=0`。

Checks:
- OpenAPI syntax + required core paths
- JSON Schema validity (events/dto/logging)
- Structured logging required fields
- Alert rules shape and severity/suppression defaults
