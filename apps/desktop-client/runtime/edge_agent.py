#!/usr/bin/env -S pkgx +python@3.12 python

import argparse
import asyncio
import json
import os
import random
import re
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import requests


@dataclass
class EdgeAccount:
    account_id: str
    account_token: str


class EdgeAgent:
    def __init__(
        self,
        central_url: str,
        edge_id: str,
        edge_secret: str,
        accounts: list[EdgeAccount],
        poll_interval: float = 5.0,
        inbox_api: str | None = None,
        user_id: str | None = None,
        simulate_dm: bool = True,
        dm_probability: float = 0.12,
        skills_dir: str | None = None,
        skill_manifest_path: str | None = None,
        skills_json_path: str | None = None,
        cli_anything_bootstrap: bool = False,
        cli_anything_repo_url: str | None = None,
        cli_anything_dir: str | None = None,
        cli_anything_pipeline: str | None = None,
        pkgx_bin: str | None = None,
        pkgx_cache_dir: str | None = None,
        pkgx_default_packages: str | None = None,
        pkgx_exec_timeout_sec: int = 120,
    ) -> None:
        self.central_url = central_url.rstrip("/")
        self.edge_id = edge_id
        self.edge_secret = edge_secret
        self.accounts = accounts
        self.poll_interval = max(1.0, poll_interval)
        self.inbox_api = inbox_api
        self.user_id = user_id
        self.simulate_dm = simulate_dm
        self.dm_probability = max(0.0, min(1.0, dm_probability))
        self.skills_dir = skills_dir
        manifest_default = Path(__file__).with_name("SKILL.md")
        self.skill_manifest_path = skill_manifest_path or (str(manifest_default) if manifest_default.exists() else None)
        self.skills_json_path = skills_json_path
        self.cli_anything_bootstrap = cli_anything_bootstrap
        self.cli_anything_repo_url = (
            cli_anything_repo_url
            or os.getenv("EDGE_CLI_ANYTHING_REPO", "https://github.com/HKUDS/CLI-Anything.git").strip()
        )
        self.cli_anything_dir = cli_anything_dir or os.getenv("EDGE_CLI_ANYTHING_DIR", "./cli-anything")
        self.cli_anything_pipeline = cli_anything_pipeline or os.getenv("EDGE_CLI_ANYTHING_PIPELINE", "").strip()
        self.pkgx_bin = pkgx_bin or os.getenv("PKGX_BIN", "pkgx")
        self.pkgx_cache_dir = (
            pkgx_cache_dir
            or os.getenv("PKGX_CACHE_DIR", "")
            or os.getenv("PKGX_DIR", "")
            or str(Path.home() / ".pkgx")
        )
        self.pkgx_default_packages = (
            pkgx_default_packages
            or os.getenv("EDGE_PKGX_DEFAULT_PACKAGES", "+bash +coreutils +curl +git")
        )
        self.pkgx_exec_timeout_sec = max(15, int(pkgx_exec_timeout_sec))
        deny_raw = os.getenv(
            "EDGE_COMMAND_DENY_PATTERNS",
            "rm -rf, mkfs, shutdown, reboot, format , del /f /q, :(){",
        )
        self.command_deny_patterns = [x.strip().lower() for x in deny_raw.split(",") if x.strip()]
        self.command_allow_regex = os.getenv("EDGE_COMMAND_ALLOW_REGEX", "").strip()
        self.session = requests.Session()

    @property
    def _edge_headers(self) -> dict[str, str]:
        return {
            "x-edge-secret": self.edge_secret,
            "Content-Type": "application/json",
        }

    async def _request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        return await asyncio.to_thread(self.session.request, method, url, timeout=15, **kwargs)

    def _pkgx_env(self) -> dict[str, str]:
        env = os.environ.copy()
        if self.pkgx_cache_dir:
            cache_path = Path(self.pkgx_cache_dir).expanduser()
            cache_path.mkdir(parents=True, exist_ok=True)
            env.setdefault("PKGX_DIR", str(cache_path))
            env.setdefault("PKGX_CACHE_DIR", str(cache_path))
        env.setdefault("PKGX_NO_MODIFY_PATH", "1")
        env.setdefault("PKGX_DIRTY", "0")
        return env

    def _compose_pkgx_shell_command(self, raw_command: str) -> list[str]:
        command = raw_command.strip()
        if not command:
            return []
        if command.startswith("#!"):
            return []
        if command.startswith("pkgx "):
            return shlex.split(command)

        default_pkgs = [part for part in self.pkgx_default_packages.split(" ") if part.strip()]
        return [self.pkgx_bin, *default_pkgs, "--", "bash", "-lc", command]

    def _run_pkgx_command(self, raw_command: str, cwd: Path | None = None) -> tuple[bool, str]:
        ok, reason = self._validate_command(raw_command)
        if not ok:
            return False, f"blocked:{reason}"
        composed = self._compose_pkgx_shell_command(raw_command)
        if not composed:
            return True, "skip_empty_command"
        try:
            proc = subprocess.run(  # noqa: S603
                composed,
                cwd=str(cwd) if cwd else None,
                capture_output=True,
                text=True,
                timeout=self.pkgx_exec_timeout_sec,
                check=False,
                env=self._pkgx_env(),
            )
            ok = proc.returncode == 0
            output = (proc.stdout or proc.stderr or "").strip()
            prefix = "ok" if ok else f"exit={proc.returncode}"
            return ok, f"{prefix}: {output[:500]}"
        except Exception as exc:  # noqa: BLE001
            return False, str(exc)

    def _validate_command(self, raw_command: str) -> tuple[bool, str]:
        text = str(raw_command or "").strip()
        if not text:
            return False, "empty_command"
        normalized = text.lower()
        for pattern in self.command_deny_patterns:
            if pattern and pattern in normalized:
                return False, f"deny_pattern:{pattern}"
        if self.command_allow_regex:
            try:
                if re.search(self.command_allow_regex, text) is None:
                    return False, "allow_regex_mismatch"
            except re.error:
                return False, "allow_regex_invalid"
        return True, "ok"

    def _extract_skills_from_text(self, content: str) -> list[str]:
        skills: list[str] = []
        seen: set[str] = set()
        in_skill_section = False

        for line in content.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            lowered = stripped.lower()

            if lowered.startswith("##") and "skill" in lowered:
                in_skill_section = True
                continue
            if lowered.startswith("##") and "skill" not in lowered:
                in_skill_section = False

            if lowered.startswith("skill:"):
                candidate = stripped.split(":", 1)[1].strip().lower()
                candidate = re.sub(r"[^a-z0-9_\-]+", "", candidate)
                if candidate and candidate not in seen:
                    seen.add(candidate)
                    skills.append(candidate)
                continue

            if "skill_name:" in lowered:
                candidate = stripped.split(":", 1)[1].strip().lower()
                candidate = re.sub(r"[^a-z0-9_\-]+", "", candidate)
                if candidate and candidate not in seen:
                    seen.add(candidate)
                    skills.append(candidate)
                continue

            if in_skill_section and (stripped.startswith("-") or stripped.startswith("*")):
                candidate = stripped[1:].strip().split(" ", 1)[0].strip().lower()
                candidate = re.sub(r"[^a-z0-9_\-]+", "", candidate)
                if candidate and candidate not in seen:
                    seen.add(candidate)
                    skills.append(candidate)

        return skills

    def _extract_commands_from_text(self, content: str) -> list[str]:
        commands: list[str] = []
        seen: set[str] = set()

        for line in content.splitlines():
            stripped = line.strip()
            if not stripped:
                continue

            normalized = stripped.lstrip("-* ").strip()
            if normalized.startswith("`") and normalized.endswith("`"):
                normalized = normalized[1:-1].strip()
            if not normalized:
                continue

            lowered = normalized.lower()

            if normalized.startswith("$"):
                command = normalized[1:].strip()
            elif lowered.startswith("#!/usr/bin/env -s pkgx"):
                # Shebang lines are examples in SKILL.md, not direct shell commands.
                # Runtime execution should use explicit "# pkgx:" entries.
                continue
            elif lowered.startswith("# pkgx:"):
                command = normalized.split(":", 1)[1].strip()
            elif lowered.startswith("cli-anything"):
                command = normalized
            elif lowered.startswith("npx clawhub"):
                command = normalized
            else:
                continue

            if command and command not in seen:
                seen.add(command)
                commands.append(command)

        return commands

    def _load_skills_json(self) -> tuple[list[str], list[str], dict[str, Any]]:
        path_raw = (self.skills_json_path or "").strip()
        if not path_raw:
            return [], [], {}

        path = Path(path_raw)
        if not path.exists() or not path.is_file():
            return [], [], {"json_path": str(path), "json_error": "not_found"}

        try:
            payload = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
        except Exception as exc:  # noqa: BLE001
            return [], [], {"json_path": str(path), "json_error": str(exc)}

        skills: list[str] = []
        commands: list[str] = []

        if isinstance(payload, dict):
            raw_skills = payload.get("skills")
            if isinstance(raw_skills, list):
                skills = [
                    re.sub(r"[^a-z0-9_\-]+", "", str(item).strip().lower())
                    for item in raw_skills
                    if str(item).strip()
                ]
            raw_commands = payload.get("commands") or payload.get("entrypoints")
            if isinstance(raw_commands, list):
                commands = [str(item).strip() for item in raw_commands if str(item).strip()]

        return skills[:64], commands[:50], {"json_path": str(path)}

    def _run_command(self, command: list[str], cwd: Path | None = None) -> tuple[bool, str]:
        try:
            proc = subprocess.run(  # noqa: S603
                command,
                cwd=str(cwd) if cwd else None,
                capture_output=True,
                text=True,
                timeout=self.pkgx_exec_timeout_sec,
                check=False,
                env=self._pkgx_env(),
            )
            ok = proc.returncode == 0
            out = (proc.stdout or proc.stderr or "").strip()
            return ok, out[:500]
        except Exception as exc:  # noqa: BLE001
            return False, str(exc)

    def _bootstrap_cli_anything(self) -> dict[str, Any]:
        if not self.cli_anything_bootstrap:
            return {"enabled": False}

        repo_dir = Path(self.cli_anything_dir).resolve()
        rows: list[dict[str, Any]] = []

        if not repo_dir.exists():
            git_bin = shutil.which("git")
            if not git_bin:
                return {
                    "enabled": True,
                    "ok": False,
                    "error": "git_not_found",
                    "repo_dir": str(repo_dir),
                }
            ok, out = self._run_command([git_bin, "clone", "--depth", "1", self.cli_anything_repo_url, str(repo_dir)])
            rows.append({"step": "git_clone", "ok": ok, "output": out})

        if not repo_dir.exists():
            return {
                "enabled": True,
                "ok": False,
                "error": "repo_missing_after_clone",
                "repo_dir": str(repo_dir),
                "steps": rows,
            }

        pipeline = self.cli_anything_pipeline
        if pipeline:
            commands = [cmd.strip() for cmd in pipeline.split("&&") if cmd.strip()]
        else:
            commands = [
                "pkgx +python@3.12 python --version",
                "pkgx +python@3.12 python -m pip --version",
                "pkgx +python@3.12 python -m pip install -r requirements.txt",
                "pkgx +python@3.12 python cli_anything.py --help",
                "pkgx +python@3.12 python cli_anything.py discover --target douyin --output .edge_skills.json",
                "pkgx +python@3.12 python cli_anything.py discover --target wechat --output .edge_skills.json",
                "pkgx +python@3.12 python cli_anything.py build-skill-md --input .edge_skills.json --output SKILL.md",
            ]

        for idx, raw in enumerate(commands, start=1):
            cmd = [part for part in re.split(r"\s+", raw.strip()) if part]
            if not cmd:
                continue
            ok, out = self._run_command(cmd, cwd=repo_dir)
            rows.append({"step": f"phase_{idx}", "command": raw, "ok": ok, "output": out})

        generated_skill = repo_dir / "SKILL.md"
        if generated_skill.exists() and not self.skill_manifest_path:
            self.skill_manifest_path = str(generated_skill)

        generated_json = repo_dir / ".edge_skills.json"
        if generated_json.exists() and not self.skills_json_path:
            self.skills_json_path = str(generated_json)

        success_count = len([row for row in rows if row.get("ok")])
        return {
            "enabled": True,
            "ok": success_count > 0,
            "repo_dir": str(repo_dir),
            "steps": rows,
            "success_steps": success_count,
            "total_steps": len(rows),
            "generated_skill_manifest": str(generated_skill) if generated_skill.exists() else None,
            "generated_skills_json": str(generated_json) if generated_json.exists() else None,
        }

    def _discover_skills(self) -> tuple[list[str], str | None, list[str], dict[str, Any]]:
        manifests: list[Path] = []
        explicit = (self.skill_manifest_path or "").strip()
        if explicit:
            manifests.append(Path(explicit))

        if self.skills_dir:
            root = Path(self.skills_dir)
            if root.exists():
                manifests.extend(root.rglob("SKILL.md"))

        skills: list[str] = []
        commands: list[str] = []
        seen: set[str] = set()
        cmd_seen: set[str] = set()
        used_manifest: str | None = None
        manifest_meta: dict[str, Any] = {}

        for manifest in manifests:
            if not manifest.exists() or not manifest.is_file():
                continue

            used_manifest = used_manifest or str(manifest)
            try:
                content = manifest.read_text(encoding="utf-8", errors="ignore")
            except Exception:  # noqa: BLE001
                continue

            for candidate in self._extract_skills_from_text(content):
                if candidate and candidate not in seen:
                    seen.add(candidate)
                    skills.append(candidate)

            for command in self._extract_commands_from_text(content):
                if command and command not in cmd_seen:
                    cmd_seen.add(command)
                    commands.append(command)

            folder_name = manifest.parent.name.strip().lower()
            folder_name = re.sub(r"[^a-z0-9_\-]+", "", folder_name)
            if folder_name and folder_name not in {"skills", "skill"} and folder_name not in seen:
                seen.add(folder_name)
                skills.append(folder_name)

            manifest_meta = {
                "manifest_path": str(manifest),
                "manifest_name": manifest.name,
                "manifest_parent": manifest.parent.name,
            }

        json_skills, json_commands, json_meta = self._load_skills_json()
        for candidate in json_skills:
            if candidate and candidate not in seen:
                seen.add(candidate)
                skills.append(candidate)

        for command in json_commands:
            if command and command not in cmd_seen:
                cmd_seen.add(command)
                commands.append(command)

        if json_meta:
            manifest_meta.update(json_meta)

        for default_skill in ["publish-content", "monitor-dm", "inbox-watch"]:
            if default_skill not in seen:
                seen.add(default_skill)
                skills.append(default_skill)

        manifest_meta["skills_count"] = len(skills)
        manifest_meta["commands_count"] = len(commands)

        return skills[:64], used_manifest, commands[:50], manifest_meta

    async def register_edge(self) -> None:
        if not self.user_id:
            return
        if not self.accounts:
            return

        bootstrap_meta = self._bootstrap_cli_anything()
        skills, manifest_path, skill_commands, manifest_meta = self._discover_skills()
        if bootstrap_meta:
            manifest_meta["cli_anything_bootstrap"] = bootstrap_meta
        payload = {
            "edge_id": self.edge_id,
            "user_id": self.user_id,
            "account_id": self.accounts[0].account_id,
            "webhook_url": None,
            "skills": skills,
            "skill_manifest_path": manifest_path,
            "skill_commands": skill_commands,
            "skill_manifest_meta": manifest_meta,
        }

        token = os.getenv("EDGE_REGISTER_BEARER", "").strip()
        if not token:
            print("[edge] skip register: missing EDGE_REGISTER_BEARER")
            return

        try:
            resp = await self._request(
                "POST",
                f"{self.central_url}/edge/register",
                json=payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )
            if resp.status_code < 400:
                print(
                    f"[edge] register ok: {self.edge_id} skills={len(skills)} commands={len(skill_commands)}"
                )
            else:
                print(f"[edge] register failed: {resp.status_code} {resp.text}")
        except Exception as exc:  # noqa: BLE001
            print(f"[edge] register exception: {exc}")

    def _extract_package_skill_commands(self, pkg: dict[str, Any]) -> list[str]:
        commands_raw = pkg.get("edge_skill_commands")
        if isinstance(commands_raw, str):
            commands = [part.strip() for part in commands_raw.split("&&") if part.strip()]
        elif isinstance(commands_raw, list):
            commands = [str(item).strip() for item in commands_raw if str(item).strip()]
        else:
            commands = []
        # Fallback to local manifest commands when package omitted explicit ones.
        if not commands:
            _, _, local_commands, _ = self._discover_skills()
            commands = local_commands
        dedup: list[str] = []
        seen: set[str] = set()
        for cmd in commands:
            if cmd in seen:
                continue
            seen.add(cmd)
            dedup.append(cmd)
        return dedup[:30]

    def _exec_package_skill_commands(self, pkg: dict[str, Any]) -> list[dict[str, Any]]:
        package_id = str(pkg.get("content_package", {}).get("package_id") or "unknown_pkg")
        commands = self._extract_package_skill_commands(pkg)
        rows: list[dict[str, Any]] = []
        for idx, command in enumerate(commands, start=1):
            ok, out = self._run_pkgx_command(command)
            rows.append(
                {
                    "package_id": package_id,
                    "step": idx,
                    "command": command,
                    "ok": ok,
                    "output": out,
                }
            )
        return rows

    async def pull_content_packages(self) -> None:
        try:
            resp = await self._request(
                "GET",
                f"{self.central_url}/edge/pull/{self.edge_id}",
                headers=self._edge_headers,
            )
            if resp.status_code >= 400:
                print(f"[edge] pull package failed: {resp.status_code} {resp.text}")
                return
            data = resp.json()
            for pkg in data.get("packages", []):
                package_id = pkg.get("content_package", {}).get("package_id")
                print(f"[edge] received content package: {package_id} for edge={self.edge_id}")
                exec_rows = await asyncio.to_thread(self._exec_package_skill_commands, pkg)
                ok_count = len([row for row in exec_rows if row.get("ok")])
                if exec_rows:
                    print(
                        f"[edge] pkgx executed {ok_count}/{len(exec_rows)} skill commands for package={package_id}"
                    )
        except Exception as exc:  # noqa: BLE001
            print(f"[edge] pull package exception: {exc}")

    async def _fetch_inbox_dm(self, account: EdgeAccount) -> list[str]:
        if not self.inbox_api:
            return []

        try:
            resp = await self._request(
                "GET",
                self.inbox_api,
                params={
                    "edge_id": self.edge_id,
                    "account_id": account.account_id,
                    "account_token": account.account_token,
                },
            )
            if resp.status_code >= 400:
                print(f"[edge] inbox api failed {resp.status_code}: {resp.text}")
                return []
            body = resp.json()
            dms = body.get("dms", [])
            return [str(dm) for dm in dms if isinstance(dm, str) and dm.strip()]
        except Exception as exc:  # noqa: BLE001
            print(f"[edge] inbox api exception: {exc}")
            return []

    def _simulate_dm(self, account: EdgeAccount) -> list[str]:
        if not self.simulate_dm:
            return []
        if random.random() > self.dm_probability:
            return []

        candidates = [
            "Hi, how much is this package?",
            "Can I buy now? Please send details.",
            "Ask for current price and shipping ETA.",
            "How to buy this today? Is trial available?",
        ]
        return [random.choice(candidates)]

    async def collect_dm_events(self, account: EdgeAccount) -> list[str]:
        live_dms = await self._fetch_inbox_dm(account)
        sim_dms = self._simulate_dm(account)
        return live_dms + sim_dms

    async def forward_dm(self, account: EdgeAccount, dm_text: str) -> None:
        payload = {
            "edge_id": self.edge_id,
            "dm_text": dm_text,
            "account_id": account.account_id,
        }
        try:
            resp = await self._request(
                "POST",
                f"{self.central_url}/receive_dm_from_edge",
                headers=self._edge_headers,
                json=payload,
            )
            if resp.status_code >= 400:
                print(f"[edge] forward dm failed: {resp.status_code} {resp.text}")
                return
            data = resp.json()
            score = data.get("score")
            actions = data.get("followup_output", {}).get("actions", [])
            print(
                f"[edge] dm forwarded account={account.account_id} score={score} actions={len(actions)}"
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[edge] forward dm exception: {exc}")

    async def run(self) -> None:
        await self.register_edge()
        print(
            f"[edge] started edge_id={self.edge_id} accounts={len(self.accounts)} central={self.central_url}"
        )
        while True:
            await self.pull_content_packages()

            for account in self.accounts:
                dms = await self.collect_dm_events(account)
                for dm in dms:
                    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    print(f"[edge] {now} detected dm account={account.account_id}: {dm}")
                    await self.forward_dm(account, dm)

            await asyncio.sleep(self.poll_interval)


def _split_values(raw: list[str]) -> list[str]:
    values: list[str] = []
    for item in raw:
        for value in item.split(","):
            norm = value.strip()
            if norm:
                values.append(norm)
    return values


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Edge Lobster agent runtime")
    parser.add_argument("--central_url", default=os.getenv("CENTRAL_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--edge_id", required=True)
    parser.add_argument("--edge_secret", default=os.getenv("EDGE_SHARED_SECRET", "edge-demo-secret"))
    parser.add_argument("--user_id", default=os.getenv("EDGE_USER_ID"))

    parser.add_argument("--account_id", action="append", default=[])
    parser.add_argument("--account_token", action="append", default=[])

    parser.add_argument("--poll_interval", type=float, default=5.0)
    parser.add_argument("--inbox_api", default=None)
    parser.add_argument("--simulate_dm", action="store_true", default=False)
    parser.add_argument("--dm_probability", type=float, default=0.12)
    parser.add_argument("--skills_dir", default=os.getenv("EDGE_SKILLS_DIR"))
    parser.add_argument("--skill_manifest_path", default=os.getenv("EDGE_SKILL_MANIFEST_PATH"))
    parser.add_argument("--skills_json_path", default=os.getenv("EDGE_SKILLS_JSON_PATH"))
    parser.add_argument(
        "--cli_anything_bootstrap",
        action="store_true",
        default=os.getenv("EDGE_CLI_ANYTHING_BOOTSTRAP", "false").strip().lower() in {"1", "true", "yes", "on"},
    )
    parser.add_argument("--cli_anything_repo_url", default=os.getenv("EDGE_CLI_ANYTHING_REPO"))
    parser.add_argument("--cli_anything_dir", default=os.getenv("EDGE_CLI_ANYTHING_DIR"))
    parser.add_argument("--cli_anything_pipeline", default=os.getenv("EDGE_CLI_ANYTHING_PIPELINE"))
    parser.add_argument("--pkgx_bin", default=os.getenv("PKGX_BIN", "pkgx"))
    parser.add_argument("--pkgx_cache_dir", default=os.getenv("PKGX_CACHE_DIR", os.getenv("PKGX_DIR", "~/.pkgx")))
    parser.add_argument("--pkgx_default_packages", default=os.getenv("EDGE_PKGX_DEFAULT_PACKAGES", "+bash +coreutils +curl +git"))
    parser.add_argument("--pkgx_exec_timeout_sec", type=int, default=int(os.getenv("EDGE_PKGX_EXEC_TIMEOUT_SEC", "120")))
    return parser.parse_args()


def build_accounts(args: argparse.Namespace) -> list[EdgeAccount]:
    account_ids = _split_values(args.account_id)
    account_tokens = _split_values(args.account_token)

    if not account_ids:
        account_ids = [f"{args.edge_id}-account-1"]

    if not account_tokens:
        raise ValueError("At least one --account_token is required")

    accounts: list[EdgeAccount] = []
    for idx, account_id in enumerate(account_ids):
        token = account_tokens[idx] if idx < len(account_tokens) else account_tokens[0]
        accounts.append(EdgeAccount(account_id=account_id, account_token=token))
    return accounts


async def _main() -> None:
    args = parse_args()
    accounts = build_accounts(args)

    agent = EdgeAgent(
        central_url=args.central_url,
        edge_id=args.edge_id,
        edge_secret=args.edge_secret,
        accounts=accounts,
        poll_interval=args.poll_interval,
        inbox_api=args.inbox_api,
        user_id=args.user_id,
        simulate_dm=args.simulate_dm,
        dm_probability=args.dm_probability,
        skills_dir=args.skills_dir,
        skill_manifest_path=args.skill_manifest_path,
        skills_json_path=args.skills_json_path,
        cli_anything_bootstrap=args.cli_anything_bootstrap,
        cli_anything_repo_url=args.cli_anything_repo_url,
        cli_anything_dir=args.cli_anything_dir,
        cli_anything_pipeline=args.cli_anything_pipeline,
        pkgx_bin=args.pkgx_bin,
        pkgx_cache_dir=args.pkgx_cache_dir,
        pkgx_default_packages=args.pkgx_default_packages,
        pkgx_exec_timeout_sec=args.pkgx_exec_timeout_sec,
    )
    await agent.run()


if __name__ == "__main__":
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        print("\n[edge] stopped")
    except Exception as exc:  # noqa: BLE001
        print(f"[edge] fatal: {exc}")
        sys.exit(1)
