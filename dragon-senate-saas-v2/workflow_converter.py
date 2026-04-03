from __future__ import annotations

import os
from typing import Any

import httpx


_LINK_TYPE_HINTS = {
    "MODEL",
    "CLIP",
    "VAE",
    "LATENT",
    "CONDITIONING",
    "IMAGE",
    "MASK",
    "CONTROL_NET",
    "SAMPLER",
    "SIGMAS",
    "NOISE",
}

_KNOWN_WIDGET_HINTS: dict[str, list[str]] = {
    "CLIPTextEncode": ["text"],
    "CheckpointLoaderSimple": ["ckpt_name"],
    "VAELoader": ["vae_name"],
    "LoraLoader": ["lora_name", "strength_model", "strength_clip"],
    "KSampler": ["seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"],
    "EmptyLatentImage": ["width", "height", "batch_size"],
    "SaveImage": ["filename_prefix"],
}


def _base_url() -> str:
    return (os.getenv("COMFYUI_BASE_URL", "").strip() or "http://127.0.0.1:8188").rstrip("/")


def _timeout() -> float:
    raw = os.getenv("COMFYUI_CONVERTER_TIMEOUT_SEC", "8").strip()
    try:
        value = float(raw)
    except ValueError:
        value = 8.0
    return max(3.0, min(value, 30.0))


def _use_object_info() -> bool:
    raw = os.getenv("COMFYUI_CONVERTER_USE_OBJECT_INFO", "false").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def is_ui_workflow_payload(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    nodes = payload.get("nodes")
    return isinstance(nodes, list) and len(nodes) > 0


def _normalize_node_id(raw: Any) -> str:
    if isinstance(raw, (int, float)):
        return str(int(raw))
    return str(raw).strip()


def _normalize_slot(raw: Any) -> int:
    if isinstance(raw, bool):
        return 0
    if isinstance(raw, (int, float)):
        return int(raw)
    try:
        return int(str(raw).strip())
    except Exception:  # noqa: BLE001
        return 0


def _parse_links(payload: dict[str, Any]) -> dict[int, dict[str, Any]]:
    rows: dict[int, dict[str, Any]] = {}
    links = payload.get("links")
    if not isinstance(links, list):
        return rows
    for item in links:
        if not isinstance(item, list) or len(item) < 6:
            continue
        try:
            link_id = int(item[0])
        except Exception:  # noqa: BLE001
            continue
        rows[link_id] = {
            "source_id": _normalize_node_id(item[1]),
            "source_slot": _normalize_slot(item[2]),
            "target_id": _normalize_node_id(item[3]),
            "target_slot": _normalize_slot(item[4]),
            "data_type": str(item[5]),
        }
    return rows


def _ordered_widget_names_from_object_info(info_row: dict[str, Any], already_bound: set[str]) -> list[str]:
    input_section = info_row.get("input")
    if not isinstance(input_section, dict):
        return []
    names: list[str] = []
    for block in ("required", "optional"):
        group = input_section.get(block)
        if not isinstance(group, dict):
            continue
        for name, type_spec in group.items():
            if name in already_bound:
                continue
            primary_type = ""
            if isinstance(type_spec, list) and type_spec:
                primary_type = str(type_spec[0]).upper()
            elif isinstance(type_spec, str):
                primary_type = type_spec.upper()
            if primary_type in _LINK_TYPE_HINTS:
                continue
            names.append(str(name))
    return names


def _extract_input_name_from_port(port: Any) -> str:
    if isinstance(port, dict):
        value = str(port.get("name") or "").strip()
        return value
    return ""


async def _fetch_object_info(class_types: list[str]) -> dict[str, dict[str, Any]]:
    if not _use_object_info():
        return {}
    out: dict[str, dict[str, Any]] = {}
    timeout = _timeout()
    async with httpx.AsyncClient(timeout=timeout) as client:
        for class_type in class_types:
            ct = str(class_type).strip()
            if not ct:
                continue
            url = f"{_base_url()}/object_info/{ct}"
            try:
                resp = await client.get(url)
                if resp.status_code >= 400:
                    continue
                payload = resp.json()
            except Exception:  # noqa: BLE001
                continue
            if isinstance(payload, dict):
                if ct in payload and isinstance(payload[ct], dict):
                    out[ct] = payload[ct]
                elif isinstance(payload.get("input"), dict):
                    out[ct] = payload
    return out


def _widget_names_fallback(class_type: str, already_bound: set[str]) -> list[str]:
    hints = _KNOWN_WIDGET_HINTS.get(class_type, [])
    return [name for name in hints if name not in already_bound]


async def convert_ui_workflow_to_api_prompt(payload: dict[str, Any]) -> dict[str, Any]:
    if not is_ui_workflow_payload(payload):
        return {"ok": False, "error": "not_ui_workflow_payload"}

    nodes_raw = payload.get("nodes", [])
    if not isinstance(nodes_raw, list):
        return {"ok": False, "error": "ui_nodes_not_list"}

    links = _parse_links(payload)
    class_types: list[str] = []
    for node in nodes_raw:
        if isinstance(node, dict):
            class_types.append(str(node.get("type") or node.get("class_type") or "").strip())
    object_info = await _fetch_object_info(class_types)

    prompt: dict[str, Any] = {}
    warnings: list[str] = []
    converted_nodes = 0

    for node in nodes_raw:
        if not isinstance(node, dict):
            continue
        node_id = _normalize_node_id(node.get("id"))
        class_type = str(node.get("type") or node.get("class_type") or "").strip()
        if not node_id or not class_type:
            continue

        inputs_payload: dict[str, Any] = {}
        bound_names: set[str] = set()

        node_inputs = node.get("inputs", [])
        if isinstance(node_inputs, list):
            for port in node_inputs:
                if not isinstance(port, dict):
                    continue
                name = _extract_input_name_from_port(port)
                link_id = port.get("link")
                if not name or link_id is None:
                    continue
                try:
                    link_id_int = int(link_id)
                except Exception:  # noqa: BLE001
                    continue
                link_row = links.get(link_id_int)
                if not link_row:
                    continue
                inputs_payload[name] = [str(link_row["source_id"]), int(link_row["source_slot"])]
                bound_names.add(name)

        widgets_values = node.get("widgets_values", [])
        if isinstance(widgets_values, list) and widgets_values:
            names = []
            info_row = object_info.get(class_type, {})
            if isinstance(info_row, dict):
                names = _ordered_widget_names_from_object_info(info_row, bound_names)
            if not names:
                names = _widget_names_fallback(class_type, bound_names)

            for idx, value in enumerate(widgets_values):
                if idx < len(names):
                    inputs_payload[names[idx]] = value
                    bound_names.add(names[idx])
                else:
                    # Keep overflow widgets in stable keys for debugging/manual fixing.
                    inputs_payload[f"widget_{idx}"] = value
                    warnings.append(f"{node_id}:{class_type}:unmapped_widget_index_{idx}")

        prompt[node_id] = {"class_type": class_type, "inputs": inputs_payload}
        converted_nodes += 1

    if not prompt:
        return {"ok": False, "error": "no_convertible_nodes"}

    return {
        "ok": True,
        "prompt": prompt,
        "diagnostics": {
            "source_format": "comfyui_ui_workflow",
            "converted_nodes": converted_nodes,
            "link_count": len(links),
            "warning_count": len(warnings),
            "warnings": warnings[:50],
        },
    }


async def auto_convert_workflow_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {"ok": False, "error": "workflow_payload_not_object"}

    prompt_field = payload.get("prompt")
    if isinstance(prompt_field, dict):
        return {
            "ok": True,
            "prompt": prompt_field,
            "converted": False,
            "source_format": "wrapped_prompt",
            "diagnostics": {},
        }

    workflow_field = payload.get("workflow")
    if isinstance(workflow_field, dict):
        inner_prompt = workflow_field.get("prompt")
        if isinstance(inner_prompt, dict):
            return {
                "ok": True,
                "prompt": inner_prompt,
                "converted": False,
                "source_format": "workflow.prompt",
                "diagnostics": {},
            }

    if payload and all(str(key).isdigit() for key in payload.keys()):
        return {
            "ok": True,
            "prompt": payload,
            "converted": False,
            "source_format": "api_prompt",
            "diagnostics": {},
        }

    if is_ui_workflow_payload(payload):
        converted = await convert_ui_workflow_to_api_prompt(payload)
        if not converted.get("ok"):
            return converted
        return {
            "ok": True,
            "prompt": converted.get("prompt", {}),
            "converted": True,
            "source_format": "comfyui_ui_workflow",
            "diagnostics": converted.get("diagnostics", {}),
        }

    return {"ok": False, "error": "unsupported_workflow_json_format"}
