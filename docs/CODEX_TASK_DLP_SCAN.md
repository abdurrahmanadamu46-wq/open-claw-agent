# CODEX TASK: 边缘节点 DLP 凭证泄露扫描

> **任务来源**：G06 — SlowMist 借鉴分析差距报告 2026-04-01  
> **参考文档**：docs/CODEX_TASK_SLOWMIST_EDGE_AUDIT.md / docs/SLOWMIST_SECURITY_BORROWING_ANALYSIS.md  
> **优先级**：🔴 P0 极高（Cookie/Token 可能明文落入日志文件，造成账号泄露）  
> **预估工作量**：1 天  
> **负责人**：Codex  

---

## ⚠️ 开始前：冲突检查（必须执行）

```bash
# 1. 检查 edge-runtime/ 是否已有安全扫描
grep -rn "dlp\|DLP\|cookie.*scan\|token.*detect\|credential.*check" \
  edge-runtime/ 2>/dev/null | head -20

# 2. 检查现有日志写入点
grep -rn "logger\|logging\|print.*cookie\|print.*token\|log.*session" \
  edge-runtime/ 2>/dev/null | head -20

# 3. 检查 security_audit.py 是否已存在
ls edge-runtime/security_audit.py 2>/dev/null && echo "已存在" || echo "需新建"

# 4. 检查 audit_logger.py 是否可从 edge 侧调用
grep -n "def record\|async def\|class.*Audit" \
  dragon-senate-saas-v2/audit_logger.py 2>/dev/null | head -10
```

**冲突解决原则**：
- 若 `security_audit.py` 已存在：在其基础上新增 DLP 扫描类，不覆盖现有代码
- DLP 扫描是**只读扫描**，不修改被扫描的数据，只记录和告警
- Pattern 匹配优先精确，避免误报（不能把所有 URL 都当作泄露）

---

## 一、任务目标

实现边缘节点数据防泄漏（DLP）扫描，防止凭证明文落入日志/报告：
1. **Cookie 扫描**：检测小红书/抖音/快手 Cookie 明文（`sessionid=xxx`、`web_id=xxx` 等）
2. **Token 扫描**：检测 AppSecret/AccessToken/API Key 格式字符串
3. **日志注入**：在边缘节点日志写入前自动脱敏（masking）
4. **告警上报**：发现泄露时向中控上报安全事件

---

## 二、实施方案

### 2.1 新建 security_audit.py（或追加到现有文件）

**目标文件**：`edge-runtime/security_audit.py`（新建或追加）

```python
"""
边缘节点 DLP（数据防泄漏）扫描模块
借鉴 SlowMist OpenClaw Security Practice Guide

设计理念：
- 扫描不修改：只记录和告警，不阻断数据流
- 正则优先：精确匹配平台特定 Cookie 格式，避免误报
- 自动脱敏：在日志写入前 mask 凭证内容
- 轻量运行：edge 节点资源有限，扫描逻辑必须 < 5ms
"""
from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger("edge.security_audit")

# ════════════════════════════════════════════════════════════════
# DLP Pattern 定义（覆盖主要中国社交平台凭证格式）
# ════════════════════════════════════════════════════════════════

DLP_PATTERNS: list[tuple[str, re.Pattern[str], str]] = [
    # 小红书
    ("xhs_cookie_sessionid",    re.compile(r'(sessionid|session_id)\s*[=:]\s*[a-zA-Z0-9_\-]{20,}', re.I), "小红书 Session"),
    ("xhs_cookie_webid",        re.compile(r'(web_id|webid)\s*[=:]\s*[0-9]{10,}', re.I), "小红书 WebID"),
    ("xhs_cookie_gid",          re.compile(r'(gid|galaxy_id)\s*[=:]\s*[a-zA-Z0-9_\-]{20,}', re.I), "小红书 GID"),
    # 抖音/TikTok
    ("douyin_sessionid",        re.compile(r'sessionid_ss\s*=\s*[a-zA-Z0-9_\-]{20,}', re.I), "抖音 SessionID"),
    ("douyin_passport_csrf",    re.compile(r'passport_csrf_token\s*=\s*[a-zA-Z0-9_\-]{20,}', re.I), "抖音 CSRF Token"),
    ("douyin_odin_tt",          re.compile(r'odin_tt\s*=\s*[a-zA-Z0-9_\-]{20,}', re.I), "抖音 Odin"),
    # 快手
    ("kuaishou_kuaishou_st",    re.compile(r'kuaishou\.sid\s*=\s*[a-zA-Z0-9_\-]{20,}', re.I), "快手 SID"),
    ("kuaishou_didv",           re.compile(r'did\s*=\s*[a-zA-Z0-9_\-]{20,}', re.I), "快手 DID"),
    # 通用 Token/Key
    ("generic_api_key",         re.compile(r'(api[_\-]?key|access[_\-]?token|app[_\-]?secret)\s*[=:]\s*[a-zA-Z0-9_\-\.]{20,}', re.I), "通用 API Key"),
    ("bearer_token",            re.compile(r'bearer\s+[a-zA-Z0-9_\-\.]{20,}', re.I), "Bearer Token"),
    ("authorization_header",    re.compile(r'authorization\s*:\s*(bearer|basic)\s+[a-zA-Z0-9_\-\.=+/]{20,}', re.I), "Authorization Header"),
    # 数据库凭证
    ("db_connection_string",    re.compile(r'(mysql|postgresql|mongodb|redis)://[^:]+:[^@]+@', re.I), "数据库连接字符串"),
]

# 脱敏替换规则：保留前3位 + 中间 mask + 保留后3位
def _mask_value(match_text: str) -> str:
    """对匹配到的凭证值进行脱敏"""
    parts = match_text.split("=", 1) if "=" in match_text else match_text.split(":", 1)
    if len(parts) == 2:
        key_part = parts[0]
        val_part = parts[1].strip()
        if len(val_part) > 8:
            masked = val_part[:3] + "****" + val_part[-3:]
        else:
            masked = "****"
        sep = "=" if "=" in match_text else ":"
        return f"{key_part}{sep}{masked}"
    return "****"


# ════════════════════════════════════════════════════════════════
# 扫描函数
# ════════════════════════════════════════════════════════════════

class DLPScanResult:
    """DLP 扫描结果"""
    def __init__(self) -> None:
        self.hits: list[dict[str, Any]] = []
        self.has_leakage: bool = False

    def add_hit(self, pattern_id: str, description: str, context: str, source: str) -> None:
        self.hits.append({
            "pattern_id": pattern_id,
            "description": description,
            "context": context[:80] + "..." if len(context) > 80 else context,
            "source": source,
        })
        self.has_leakage = True


def scan_text(text: str, source: str = "unknown") -> DLPScanResult:
    """
    扫描文本中的凭证泄露
    
    Args:
        text: 要扫描的文本
        source: 来源标识（如 "log_line"、"api_response"、"file:xxx"）
    
    Returns:
        DLPScanResult，包含所有命中的 Pattern
    """
    result = DLPScanResult()
    for pattern_id, pattern, description in DLP_PATTERNS:
        matches = pattern.findall(text)
        if matches:
            # 提取上下文（命中位置前后20个字符）
            for m in pattern.finditer(text):
                start = max(0, m.start() - 20)
                end = min(len(text), m.end() + 20)
                context = text[start:end]
                result.add_hit(pattern_id, description, context, source)
            break  # 同一 pattern_id 只记录一次
    return result


def mask_sensitive_text(text: str) -> str:
    """
    对文本进行脱敏处理，替换所有检测到的凭证
    用于日志写入前的自动脱敏
    """
    masked = text
    for pattern_id, pattern, description in DLP_PATTERNS:
        def _replacer(m: re.Match) -> str:
            return _mask_value(m.group(0))
        masked = pattern.sub(_replacer, masked)
    return masked


# ════════════════════════════════════════════════════════════════
# 日志过滤器（集成到 Python logging 系统）
# ════════════════════════════════════════════════════════════════

class DLPLogFilter(logging.Filter):
    """
    自动对日志消息进行 DLP 脱敏的 logging Filter
    
    用法：
        import logging
        from security_audit import DLPLogFilter
        
        # 在 edge 节点的日志配置中添加
        handler = logging.StreamHandler()
        handler.addFilter(DLPLogFilter())
        logging.root.addHandler(handler)
    """
    
    def filter(self, record: logging.LogRecord) -> bool:
        # 脱敏日志消息
        if isinstance(record.msg, str):
            original = record.msg
            record.msg = mask_sensitive_text(original)
            if original != record.msg:
                logger.warning("[DLP] Masked credential in log from %s", record.name)
        return True


def install_dlp_log_filter() -> None:
    """安装 DLP 日志过滤器到 root logger（在 edge 节点启动时调用）"""
    dlp_filter = DLPLogFilter()
    root_logger = logging.getLogger()
    for handler in root_logger.handlers:
        handler.addFilter(dlp_filter)
    # 也为新添加的 handler 安装
    logging.root.addFilter(dlp_filter)
    logger.info("[DLP] Log filter installed")


# ════════════════════════════════════════════════════════════════
# 告警上报（向中控发送安全事件）
# ════════════════════════════════════════════════════════════════

async def report_dlp_alert(
    scan_result: DLPScanResult,
    *,
    edge_node_id: str,
    tenant_id: str = "tenant_main",
) -> None:
    """
    向中控上报 DLP 告警
    复用现有 wss_receiver 的事件上报机制
    """
    if not scan_result.has_leakage:
        return

    alert_payload = {
        "event": "dlp_credential_leak_detected",
        "edge_node_id": edge_node_id,
        "tenant_id": tenant_id,
        "hit_count": len(scan_result.hits),
        "hits": scan_result.hits,
    }
    logger.error("[DLP] ALERT: %d credential pattern(s) detected! node=%s", len(scan_result.hits), edge_node_id)

    try:
        import os
        import json
        import aiohttp
        central_url = os.getenv("CENTRAL_API_URL", "")
        if central_url:
            async with aiohttp.ClientSession() as session:
                await session.post(
                    f"{central_url}/api/v1/security/dlp-alerts",
                    json=alert_payload,
                    timeout=aiohttp.ClientTimeout(total=5),
                )
    except Exception as e:
        logger.warning("[DLP] Failed to report alert to central: %s", e)
```

---

### 2.2 集成到 wss_receiver.py（边缘节点入口）

**目标文件**：`edge-runtime/wss_receiver.py`  
**修改位置**：启动时安装 DLP 日志过滤器；处理来自平台的 API 响应时扫描

```python
# 在 wss_receiver.py 的启动函数中（main() 或 on_connect()）：

from security_audit import install_dlp_log_filter, scan_text, report_dlp_alert

# 启动时安装日志过滤器
install_dlp_log_filter()

# 在处理平台 API 响应时，扫描 response body
async def on_platform_response(response_text: str, edge_node_id: str):
    """平台 API 响应处理（在现有处理逻辑中插入扫描）"""
    # 🆕 DLP 扫描（在现有处理逻辑之前）
    scan_result = scan_text(response_text, source="platform_api_response")
    if scan_result.has_leakage:
        await report_dlp_alert(scan_result, edge_node_id=edge_node_id)

    # 现有处理逻辑（保持不变）...
```

---

### 2.3 集成到 marionette_executor.py（浏览器操作层）

**目标文件**：`edge-runtime/marionette_executor.py`  
**修改位置**：截图/日志记录前进行 DLP 扫描

```python
# 在截图或日志记录前插入 DLP 扫描

from security_audit import scan_text, mask_sensitive_text

# 记录操作日志时（替换直接 logging）
def _safe_log(self, message: str) -> None:
    """带 DLP 脱敏的日志记录"""
    safe_message = mask_sensitive_text(message)
    logger.info(safe_message)
```

---

### 2.4 单元测试

**目标文件**：`edge-runtime/tests/test_security_audit.py`（新建）

```python
"""DLP 扫描模块单元测试"""
import pytest
from security_audit import scan_text, mask_sensitive_text, DLP_PATTERNS

class TestScanText:
    def test_detects_xhs_sessionid(self):
        text = "cookie: sessionid=abcdef1234567890abcdef1234567890"
        result = scan_text(text, "test")
        assert result.has_leakage is True
        assert any(h["pattern_id"] == "xhs_cookie_sessionid" for h in result.hits)

    def test_detects_bearer_token(self):
        text = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx"
        result = scan_text(text, "test")
        assert result.has_leakage is True

    def test_detects_api_key(self):
        text = "api_key=sk-1234567890abcdef1234567890abcdef"
        result = scan_text(text, "test")
        assert result.has_leakage is True

    def test_clean_text_passes(self):
        text = "用户发布了一条小红书笔记，点赞数 1234"
        result = scan_text(text, "test")
        assert result.has_leakage is False

    def test_db_connection_detected(self):
        text = "mysql://root:password123@localhost:3306/db"
        result = scan_text(text, "test")
        assert result.has_leakage is True

class TestMaskText:
    def test_masks_sessionid(self):
        text = "sessionid=abcdef1234567890"
        masked = mask_sensitive_text(text)
        assert "abcdef1234567890" not in masked
        assert "****" in masked

    def test_preserves_clean_content(self):
        text = "正常的业务日志内容，没有凭证"
        masked = mask_sensitive_text(text)
        assert masked == text
```

---

## 三、前端工程师对接说明

### 新增 API 端点

```typescript
// GET /api/v1/security/dlp-alerts
// 查询边缘节点 DLP 告警记录
interface DLPAlertItem {
  edge_node_id: string;
  tenant_id: string;
  hit_count: number;
  hits: Array<{
    pattern_id: string;
    description: string;   // "小红书 Session" / "抖音 SessionID" 等
    context: string;       // 脱敏后的上下文（凭证已 mask）
    source: string;        // 来源（"platform_api_response" 等）
  }>;
  detected_at: string;
}

// 在 /operations/ 运维页面新增"安全告警"卡片
// - 红色：has_leakage = true（展示告警详情）
// - 绿色：无告警
```

### 边缘节点健康面板新增 DLP 状态

```typescript
// 在边缘节点列表中新增 DLP 状态列：
// ✅ DLP 扫描已启用（绿色）
// ❌ DLP 扫描未启用（红色，需要运维介入）
// ⚠️ 近24小时有 N 次告警（橙色）
```

---

## 四、验收标准

- [ ] `from security_audit import scan_text, mask_sensitive_text` 正常导入
- [ ] `scan_text("sessionid=abc123...", "test").has_leakage` 返回 `True`
- [ ] `scan_text("正常业务日志", "test").has_leakage` 返回 `False`
- [ ] `mask_sensitive_text("api_key=sk-1234...")` 返回脱敏版本（含 `****`）
- [ ] DLP 日志过滤器安装后，含 Cookie 的日志自动脱敏
- [ ] 检测到泄露时，向中控发出 DLP 告警事件
- [ ] `python -m pytest edge-runtime/tests/test_security_audit.py` 全部通过
- [ ] edge 节点启动日志中出现 `[DLP] Log filter installed`

---

## 五、实施顺序

```
上午（3小时）：
  ① 冲突检查（4条命令）
  ② 新建/追加 edge-runtime/security_audit.py（完整代码见 2.1）
  ③ 在 wss_receiver.py 启动时调用 install_dlp_log_filter()（见 2.2，2行代码）

下午（2小时）：
  ④ 在 marionette_executor.py 中替换直接 logging 为 _safe_log()（见 2.3）
  ⑤ 新建 edge-runtime/tests/test_security_audit.py 并通过（见 2.4）

收尾（1小时）：
  ⑥ 在 app.py 新增 GET /api/v1/security/dlp-alerts 端点
  ⑦ 更新 PROJECT_CONTROL_CENTER.md（标记 CODEX_SLOWMIST_DLP_SCAN 为 ✅）
```

---

*创建时间：2026-04-01 | 来源：BORROWING_GAP_ANALYSIS_2026-04-01.md G06*
