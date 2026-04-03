"""
Public intake form and review queue.
"""

from __future__ import annotations

import html
import os
import sqlite3
import time
import uuid
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any


DB_PATH = Path(os.getenv("INTAKE_FORM_DB", "./data/intake_form.sqlite"))
PRIORITY_VALUES = {"urgent", "high", "medium", "low"}
MAX_TITLE_LEN = 200
MAX_DESC_LEN = 2000


@dataclass(slots=True)
class IntakeSubmission:
    intake_id: str
    tenant_slug: str
    title: str
    description: str
    priority: str
    contact: str
    tenant_id: str = "tenant_main"
    status: str = "pending"
    reject_reason: str = ""
    created_at: float = field(default_factory=time.time)
    reviewed_at: float = 0.0
    reviewer_id: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class IntakeFormHandler:
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS intake_submissions (
                    intake_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    tenant_slug TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    priority TEXT DEFAULT 'medium',
                    contact TEXT DEFAULT '',
                    status TEXT DEFAULT 'pending',
                    reject_reason TEXT DEFAULT '',
                    created_at REAL NOT NULL,
                    reviewed_at REAL DEFAULT 0,
                    reviewer_id TEXT DEFAULT ''
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_intake_tenant_status ON intake_submissions(tenant_id, status, created_at DESC)"
            )
            conn.commit()
        finally:
            conn.close()

    def submit(
        self,
        *,
        tenant_slug: str,
        title: str,
        description: str,
        priority: str = "medium",
        contact: str = "",
        tenant_id: str = "tenant_main",
    ) -> dict[str, Any]:
        normalized_title = str(title or "").strip()[:MAX_TITLE_LEN]
        normalized_description = str(description or "").strip()[:MAX_DESC_LEN]
        normalized_priority = str(priority or "medium").strip().lower()
        if normalized_priority not in PRIORITY_VALUES:
            normalized_priority = "medium"
        normalized_contact = str(contact or "").strip()[:100]
        if not normalized_title:
            return {"success": False, "error": "需求标题不能为空"}
        submission = IntakeSubmission(
            intake_id=f"intk_{uuid.uuid4().hex[:12]}",
            tenant_slug=tenant_slug,
            tenant_id=tenant_id,
            title=normalized_title,
            description=normalized_description,
            priority=normalized_priority,
            contact=normalized_contact,
        )
        conn = self._conn()
        try:
            conn.execute(
                """
                INSERT INTO intake_submissions (
                    intake_id, tenant_id, tenant_slug, title, description, priority,
                    contact, status, reject_reason, created_at, reviewed_at, reviewer_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    submission.intake_id,
                    submission.tenant_id,
                    submission.tenant_slug,
                    submission.title,
                    submission.description,
                    submission.priority,
                    submission.contact,
                    submission.status,
                    submission.reject_reason,
                    submission.created_at,
                    submission.reviewed_at,
                    submission.reviewer_id,
                ),
            )
            conn.commit()
        finally:
            conn.close()
        return {
            "success": True,
            "intake_id": submission.intake_id,
            "message": "需求已提交，我们会尽快处理。",
        }

    def list_submissions(self, tenant_id: str, status: str = "pending") -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            rows = conn.execute(
                """
                SELECT * FROM intake_submissions
                WHERE tenant_id=? AND status=?
                ORDER BY created_at DESC
                """,
                (tenant_id, status),
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def accept(self, intake_id: str, tenant_id: str, reviewer_id: str) -> dict[str, Any]:
        row = self._get_pending(intake_id, tenant_id)
        if not row:
            return {"success": False, "error": "记录不存在或已处理"}
        conn = self._conn()
        now = time.time()
        try:
            conn.execute(
                """
                UPDATE intake_submissions
                SET status='accepted', reviewed_at=?, reviewer_id=?
                WHERE intake_id=?
                """,
                (now, reviewer_id, intake_id),
            )
            conn.commit()
        finally:
            conn.close()
        return {"success": True, "intake_id": intake_id}

    def reject(self, intake_id: str, tenant_id: str, reviewer_id: str, reason: str = "") -> dict[str, Any]:
        row = self._get_pending(intake_id, tenant_id)
        if not row:
            return {"success": False, "error": "记录不存在或已处理"}
        conn = self._conn()
        now = time.time()
        try:
            conn.execute(
                """
                UPDATE intake_submissions
                SET status='rejected', reject_reason=?, reviewed_at=?, reviewer_id=?
                WHERE intake_id=?
                """,
                (str(reason or "").strip()[:500], now, reviewer_id, intake_id),
            )
            conn.commit()
        finally:
            conn.close()
        return {"success": True, "intake_id": intake_id}

    def get_submission(self, intake_id: str) -> dict[str, Any]:
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM intake_submissions WHERE intake_id=?",
                (intake_id,),
            ).fetchone()
            return dict(row) if row else {}
        finally:
            conn.close()

    def _get_pending(self, intake_id: str, tenant_id: str) -> dict[str, Any]:
        row = self.get_submission(intake_id)
        if not row:
            return {}
        if str(row.get("tenant_id") or "") != tenant_id:
            return {}
        if str(row.get("status") or "") != "pending":
            return {}
        return row


def render_intake_page(tenant_slug: str) -> str:
    safe_slug = html.escape(tenant_slug, quote=True)
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>提交需求</title>
  <style>
    body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:48px auto;padding:0 20px;color:#111827;background:#f8fafc;}}
    h1{{font-size:26px;margin-bottom:6px;}}
    .sub{{color:#64748b;font-size:14px;margin-bottom:28px;}}
    label{{display:block;font-size:13px;font-weight:600;margin-bottom:6px;}}
    input,textarea,select{{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;margin-bottom:16px;box-sizing:border-box;outline:none;background:white;}}
    input:focus,textarea:focus,select:focus{{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.12);}}
    button{{background:#6366f1;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:14px;cursor:pointer;width:100%;font-weight:600;}}
    button:hover{{background:#4f46e5;}}
    .success{{color:#166534;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;display:none;margin-top:12px;}}
    .error{{color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;display:none;margin-top:12px;}}
  </style>
</head>
<body>
  <h1>提交需求</h1>
  <p class="sub">告诉我们你的想法，系统会把它送进 catcher 的待处理队列。</p>
  <form id="intake-form">
    <label>需求标题 *</label>
    <input type="text" id="f-title" maxlength="200" required>
    <label>详细描述</label>
    <textarea id="f-desc" rows="5" maxlength="2000"></textarea>
    <label>优先级</label>
    <select id="f-priority">
      <option value="medium">中</option>
      <option value="high">高</option>
      <option value="low">低</option>
      <option value="urgent">紧急</option>
    </select>
    <label>联系方式</label>
    <input type="text" id="f-contact" maxlength="100">
    <button type="submit">提交需求</button>
  </form>
  <div class="success" id="success-msg"></div>
  <div class="error" id="error-msg"></div>
  <script>
    document.getElementById('intake-form').addEventListener('submit', async (e) => {{
      e.preventDefault();
      const resp = await fetch('/intake/{safe_slug}', {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify({{
          title: document.getElementById('f-title').value,
          description: document.getElementById('f-desc').value,
          priority: document.getElementById('f-priority').value,
          contact: document.getElementById('f-contact').value,
        }})
      }});
      const data = await resp.json();
      const successEl = document.getElementById('success-msg');
      const errorEl = document.getElementById('error-msg');
      successEl.style.display = 'none';
      errorEl.style.display = 'none';
      if (data.success) {{
        successEl.textContent = data.message || '需求已提交';
        successEl.style.display = 'block';
        document.getElementById('intake-form').reset();
      }} else {{
        errorEl.textContent = data.error || '提交失败';
        errorEl.style.display = 'block';
      }}
    }});
  </script>
</body>
</html>"""


_default_handler: IntakeFormHandler | None = None


def get_intake_form_handler() -> IntakeFormHandler:
    global _default_handler
    if _default_handler is None:
        _default_handler = IntakeFormHandler()
    return _default_handler
