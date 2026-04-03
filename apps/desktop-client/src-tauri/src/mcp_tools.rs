//! 边缘端 MCP Tool 实现：接收中心 JSON-RPC 调用，执行本地任务并返回结果
//! 工具名：publish_video, read_screen_context

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct PublishVideoResult {
    pub ok: bool,
    pub message: String,
}

/// MCP Tool: publish_video — 在本地执行发布视频任务（占位实现）
#[tauri::command]
pub fn mcp_tool_publish_video(_args: Option<serde_json::Value>) -> Result<PublishVideoResult, String> {
    // TODO: 调用本地发布流程（例如打开创作助手、填充文案、点击发布）
    Ok(PublishVideoResult {
        ok: true,
        message: "publish_video stub: 已接收任务，待接入真实发布流程".to_string(),
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReadScreenContextResult {
    pub text: String,
    pub base64_image: Option<String>,
}

/// MCP Tool: read_screen_context — 读取当前屏幕上下文（截图由前端先 invoke capture_screen_base64 再传回）
#[tauri::command]
pub fn mcp_tool_read_screen_context(args: Option<serde_json::Value>) -> Result<ReadScreenContextResult, String> {
    let base64 = args
        .and_then(|v| v.get("base64_image").and_then(|s| s.as_str()).map(String::from));
    Ok(ReadScreenContextResult {
        text: "当前屏幕已截取，可送 VLM 进一步分析".to_string(),
        base64_image: base64,
    })
}
