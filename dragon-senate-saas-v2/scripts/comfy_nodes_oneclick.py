#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_COMFY_ROOT = Path(r"F:\ComfyUI-aki\ComfyUI-latest")
DEFAULT_LOCK_PATH = ROOT / "data" / "comfy_nodes_lock.json"
DEFAULT_REPORT_PATH = ROOT / "data" / "comfy_nodes_health_report.json"
DEFAULT_GRAY_ENV_PATH = ROOT / "data" / "comfy_gray.env"


@dataclass(slots=True)
class NodeSpec:
    key: str
    repo: str
    env_flag: str
    hints: list[str]
    enabled: bool = True
    kind: str = "custom_node"


NODE_SPECS: list[NodeSpec] = [
    NodeSpec(
        key="wanvideo_lipsync",
        repo="https://github.com/kijai/ComfyUI-WanVideoWrapper.git",
        env_flag="COMFYUI_ENABLE_WANVIDEO",
        hints=["wanvideo", "fantasytalking", "fantasyportrait", "skyreels"],
    ),
    NodeSpec(
        key="vibevoice_tts",
        repo="https://github.com/Enemyx-net/VibeVoice-ComfyUI.git",
        env_flag="COMFYUI_ENABLE_VIBEVOICE",
        hints=["vibevoice", "voiceclone", "speaker"],
    ),
    NodeSpec(
        key="portrait_master",
        repo="https://github.com/florestefano1975/comfyui-portrait-master.git",
        env_flag="COMFYUI_ENABLE_PORTRAIT_MASTER",
        hints=["portraitmaster", "basecharacter", "skin", "pose"],
    ),
    NodeSpec(
        key="controlnet_aux",
        repo="https://github.com/Fannovel16/comfyui_controlnet_aux.git",
        env_flag="COMFYUI_ENABLE_CONTROLNET_AUX",
        hints=["dwpose", "openpose", "hed", "lineart"],
    ),
    NodeSpec(
        key="layerstyle_compositor",
        repo="https://github.com/chflame163/ComfyUI_LayerStyle.git",
        env_flag="COMFYUI_ENABLE_LAYERSTYLE",
        hints=["layerstyle", "sam2", "maskmotionblur"],
    ),
    NodeSpec(
        key="easy_use_pack",
        repo="https://github.com/yolain/ComfyUI-Easy-Use.git",
        env_flag="COMFYUI_ENABLE_EASY_USE",
        hints=["easy-use", "instantid", "dynamicrafter"],
    ),
    NodeSpec(
        key="llm_party_orchestrator",
        repo="https://github.com/heshengtao/comfyui_LLM_party.git",
        env_flag="COMFYUI_ENABLE_LLM_PARTY",
        hints=["llm_party", "chattts", "gpt-sovits", "omost"],
    ),
    NodeSpec(
        key="copilot_workflow_builder",
        repo="https://github.com/AIDC-AI/ComfyUI-Copilot.git",
        env_flag="COMFYUI_ENABLE_COPILOT",
        hints=["copilot", "workflowassistant"],
    ),
    NodeSpec(
        key="custom_scripts_ui",
        repo="https://github.com/pythongosssss/ComfyUI-Custom-Scripts.git",
        env_flag="COMFYUI_ENABLE_CUSTOM_SCRIPTS",
        hints=["customscripts", "presettext", "autosort"],
    ),
    # Runtime stack, not a custom node repo in custom_nodes.
    NodeSpec(
        key="ai_dock_runtime",
        repo="https://github.com/ai-dock/comfyui.git",
        env_flag="COMFYUI_ENABLE_AI_DOCK",
        hints=["ai-dock", "docker-comfyui"],
        enabled=False,
        kind="runtime_stack",
    ),
]


def _run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        text=True,
        capture_output=True,
        check=check,
    )


def _python_bin(comfy_root: Path) -> Path:
    win = comfy_root / ".venv" / "Scripts" / "python.exe"
    if win.exists():
        return win
    return Path(sys.executable)


def _repo_name(url: str) -> str:
    tail = url.rstrip("/").split("/")[-1]
    return tail[:-4] if tail.endswith(".git") else tail


def _custom_nodes_dir(comfy_root: Path) -> Path:
    return comfy_root / "custom_nodes"


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _git_current_commit(repo_dir: Path) -> str:
    try:
        row = _run(["git", "rev-parse", "HEAD"], cwd=repo_dir)
        return row.stdout.strip()
    except Exception:
        return ""


def _pip_install_requirements(node_dir: Path, py_bin: Path) -> tuple[bool, list[str]]:
    reqs = sorted(
        [p for p in node_dir.glob("requirements*.txt") if p.is_file()],
        key=lambda p: p.name.lower(),
    )
    messages: list[str] = []
    ok = True
    for req in reqs:
        cmd = [str(py_bin), "-m", "pip", "install", "-r", str(req), "--disable-pip-version-check"]
        try:
            row = _run(cmd, cwd=node_dir, check=True)
            messages.append(f"ok:{req.name}:{row.stdout.strip()[-120:]}")
        except subprocess.CalledProcessError as exc:
            ok = False
            tail = (exc.stderr or exc.stdout or "").strip()[-280:]
            messages.append(f"fail:{req.name}:{tail}")
    return ok, messages


def _tcp_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(1.0)
        return sock.connect_ex((host, port)) == 0


def _http_json(url: str, timeout: float = 5.0) -> dict[str, Any]:
    try:
        with urlopen(url, timeout=timeout) as resp:  # noqa: S310
            return json.loads(resp.read().decode("utf-8"))
    except (URLError, TimeoutError, ValueError, OSError):
        return {}


def _wait_comfy(base_url: str, timeout_sec: int = 120) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        row = _http_json(f"{base_url}/system_stats", timeout=3.0)
        if isinstance(row, dict) and row:
            return True
        time.sleep(1.5)
    return False


def _start_comfy(comfy_root: Path, py_bin: Path, host: str, port: int) -> subprocess.Popen[str] | None:
    if _tcp_open(host, port):
        return None
    cmd = [str(py_bin), "main.py", "--listen", host, "--port", str(port), "--disable-auto-launch"]
    return subprocess.Popen(  # noqa: S603
        cmd,
        cwd=str(comfy_root),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def _stop_comfy(proc: subprocess.Popen[str] | None) -> None:
    if proc is None:
        return
    if proc.poll() is not None:
        return
    try:
        proc.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGTERM)  # type: ignore[attr-defined]
    except Exception:
        proc.terminate()
    try:
        proc.wait(timeout=10)
    except Exception:
        proc.kill()


def _runtime_health(base_url: str, specs: list[NodeSpec]) -> dict[str, Any]:
    object_info = _http_json(f"{base_url}/object_info", timeout=12.0)
    keys: list[str] = []
    if isinstance(object_info, dict):
        keys = [str(k).lower() for k in object_info.keys()]
    health: dict[str, Any] = {}
    for spec in specs:
        if spec.kind != "custom_node":
            health[spec.key] = {"runtime_loaded": False, "reason": "not_custom_node"}
            continue
        loaded = False
        for hint in spec.hints:
            hint_lower = hint.lower()
            if any(hint_lower in key for key in keys):
                loaded = True
                break
        health[spec.key] = {"runtime_loaded": loaded}
    return {"object_info_key_count": len(keys), "nodes": health}


def _write_gray_env(path: Path, comfy_root: Path, base_url: str, report: dict[str, Any]) -> None:
    lines: list[str] = []
    custom_nodes_root = str(_custom_nodes_dir(comfy_root)).replace("\\", "/")
    lines.append("COMFYUI_ENABLED=true")
    lines.append(f"COMFYUI_BASE_URL={base_url}")
    lines.append("COMFYUI_TIMEOUT_SEC=30")
    lines.append("COMFYUI_POLL_INTERVAL_SEC=2")
    lines.append("COMFYUI_POLL_ROUNDS=25")
    lines.append(f"COMFYUI_CUSTOM_NODES_ROOT={custom_nodes_root}")
    lines.append("COMFYUI_TEMPLATE_AUTO_CONVERT=true")
    lines.append("COMFYUI_CONVERTER_USE_OBJECT_INFO=true")
    node_health = (((report.get("runtime") or {}).get("nodes")) or {})
    for spec in NODE_SPECS:
        flag_value = "false"
        if spec.kind == "custom_node":
            runtime_loaded = bool(((node_health.get(spec.key) or {}).get("runtime_loaded")))
            installed = bool(((report.get("install") or {}).get(spec.key) or {}).get("installed"))
            flag_value = "true" if runtime_loaded and installed else "false"
        lines.append(f"{spec.env_flag}={flag_value}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="One-click ComfyUI custom node installer with lock+health.")
    parser.add_argument("--comfy-root", default=str(DEFAULT_COMFY_ROOT))
    parser.add_argument("--mode", choices=["lock", "latest"], default="latest")
    parser.add_argument("--lock-path", default=str(DEFAULT_LOCK_PATH))
    parser.add_argument("--report-path", default=str(DEFAULT_REPORT_PATH))
    parser.add_argument("--gray-env-path", default=str(DEFAULT_GRAY_ENV_PATH))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8188)
    parser.add_argument("--skip-pip", action="store_true")
    args = parser.parse_args()

    comfy_root = Path(args.comfy_root).resolve()
    lock_path = Path(args.lock_path).resolve()
    report_path = Path(args.report_path).resolve()
    gray_env_path = Path(args.gray_env_path).resolve()
    py_bin = _python_bin(comfy_root)
    custom_dir = _custom_nodes_dir(comfy_root)

    if not (comfy_root / "main.py").exists():
        print(f"[ERROR] ComfyUI root invalid: {comfy_root}")
        return 2
    custom_dir.mkdir(parents=True, exist_ok=True)

    lock_payload = _load_json(lock_path)
    lock_nodes = lock_payload.get("nodes", {}) if isinstance(lock_payload.get("nodes"), dict) else {}

    install_report: dict[str, Any] = {}
    next_lock_nodes: dict[str, Any] = {}

    for spec in NODE_SPECS:
        row: dict[str, Any] = {
            "repo": spec.repo,
            "env_flag": spec.env_flag,
            "kind": spec.kind,
            "installed": False,
            "commit": "",
            "deps_ok": None,
            "messages": [],
            "skipped": False,
        }

        if spec.kind != "custom_node":
            row["skipped"] = True
            row["messages"].append("runtime_stack_not_installed_in_custom_nodes")
            install_report[spec.key] = row
            next_lock_nodes[spec.key] = row
            continue

        repo_name = _repo_name(spec.repo)
        node_dir = custom_dir / repo_name

        try:
            if node_dir.exists() and (node_dir / ".git").exists():
                if args.mode == "latest":
                    _run(["git", "fetch", "--all", "--prune"], cwd=node_dir)
                    try:
                        _run(["git", "pull", "--ff-only"], cwd=node_dir)
                    except subprocess.CalledProcessError as exc:
                        row["messages"].append(f"pull_warn:{(exc.stderr or exc.stdout or '').strip()[-180:]}")
                elif args.mode == "lock":
                    lock_commit = str((lock_nodes.get(spec.key) or {}).get("commit", "")).strip()
                    if lock_commit:
                        _run(["git", "fetch", "--all", "--prune"], cwd=node_dir, check=False)
                        _run(["git", "checkout", lock_commit], cwd=node_dir)
            elif node_dir.exists():
                backup = node_dir.with_name(f"{node_dir.name}.bak_{int(time.time())}")
                shutil.move(str(node_dir), str(backup))
                _run(["git", "clone", spec.repo, str(node_dir)], cwd=custom_dir)
            else:
                _run(["git", "clone", spec.repo, str(node_dir)], cwd=custom_dir)

            row["installed"] = True
            row["commit"] = _git_current_commit(node_dir)
            if not args.skip_pip:
                deps_ok, msgs = _pip_install_requirements(node_dir, py_bin)
                row["deps_ok"] = deps_ok
                row["messages"].extend(msgs)
            else:
                row["deps_ok"] = None
                row["messages"].append("pip_install_skipped")
        except subprocess.CalledProcessError as exc:
            row["installed"] = False
            row["messages"].append((exc.stderr or exc.stdout or str(exc))[-400:])
        except Exception as exc:  # noqa: BLE001
            row["installed"] = False
            row["messages"].append(str(exc))

        install_report[spec.key] = row
        next_lock_nodes[spec.key] = {
            "repo": spec.repo,
            "kind": spec.kind,
            "commit": row.get("commit", ""),
            "updated_at": int(time.time()),
        }

    base_url = f"http://{args.host}:{args.port}"
    started_proc = _start_comfy(comfy_root, py_bin, args.host, args.port)
    reachable = _wait_comfy(base_url, timeout_sec=150)
    runtime_report = {"reachable": reachable, "base_url": base_url, "nodes": {}}
    if reachable:
        runtime_report = {"reachable": True, "base_url": base_url, **_runtime_health(base_url, NODE_SPECS)}
    _stop_comfy(started_proc)

    final_report = {
        "ok": True,
        "mode": args.mode,
        "timestamp": int(time.time()),
        "comfy_root": str(comfy_root),
        "python_bin": str(py_bin),
        "install": install_report,
        "runtime": runtime_report,
    }
    _save_json(report_path, final_report)

    lock_out = {
        "schema_version": "comfy_nodes_lock.v1",
        "generated_at": int(time.time()),
        "comfy_root": str(comfy_root),
        "nodes": next_lock_nodes,
    }
    _save_json(lock_path, lock_out)
    _write_gray_env(gray_env_path, comfy_root, base_url, final_report)

    print(json.dumps(final_report, ensure_ascii=False, indent=2))
    print(f"\n[LOCK] {lock_path}")
    print(f"[REPORT] {report_path}")
    print(f"[GRAY_ENV] {gray_env_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
