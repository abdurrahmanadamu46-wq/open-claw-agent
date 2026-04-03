//! 视觉 GUI 自动化：系统级截图 + 物理级键鼠模拟（enigo）
//! 用于绕过 DOM 反爬，由 VLM 分析画面后驱动真实点击/输入

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use enigo::{Coordinate, Direction::Click, Enigo, Keyboard, Mouse, Settings};
use image::ImageFormat;
use serde::{Deserialize, Serialize};
use std::io::Cursor;

/// 前端传来的动作参数，与 JSON 一致
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct InputActionPayload {
    /// "click" | "type"
    pub action: String,
    /// 鼠标 x（像素）
    pub x: Option<i32>,
    /// 鼠标 y（像素）
    pub y: Option<i32>,
    /// 键盘输入文本（action=type 时使用）
    pub text: Option<String>,
}

/// 截取主屏幕高清画面，返回 PNG Base64 字符串
#[tauri::command]
pub fn capture_screen_base64() -> Result<String, String> {
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let primary = monitors
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| xcap::Monitor::all().ok().and_then(|v| v.into_iter().next()))
        .ok_or_else(|| "No monitor found".to_string())?;

    let image = primary.capture_image().map_err(|e| e.to_string())?;

    let mut bytes = Vec::new();
    let mut cursor = Cursor::new(&mut bytes);
    image
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    drop(cursor);

    Ok(BASE64.encode(&bytes))
}

/// 在系统底层执行鼠标移动/点击或键盘输入
#[tauri::command]
pub fn execute_input(payload: InputActionPayload) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;

    match payload.action.to_lowercase().as_str() {
        "click" => {
            let x = payload.x.unwrap_or(0);
            let y = payload.y.unwrap_or(0);
            enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
            enigo.button(enigo::Button::Left, Click).map_err(|e| e.to_string())?;
        }
        "type" => {
            let text = payload.text.unwrap_or_default();
            enigo.text(&text).map_err(|e| e.to_string())?;
        }
        _ => return Err(format!("Unknown action: {}", payload.action)),
    }
    Ok(())
}
