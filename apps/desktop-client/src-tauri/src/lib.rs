// Lobster 龙虾节点 - 托盘驻留 + 连接大脑
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod visual_automation;
mod mcp_tools;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg(not(mobile))]
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use tauri::{menu::{Menu, MenuItem}, tray::TrayIconBuilder};

    let show_item = MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "完全退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(move |app_handle, event| {
            match event.id.as_ref() {
                "show" => {
                    if let Some(w) = app_handle.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                "quit" => {
                    app_handle.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    // 启动时主窗口已由 tauri.conf.json 设为 visible: false，无需再藏
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            visual_automation::capture_screen_base64,
            visual_automation::execute_input,
            mcp_tools::mcp_tool_publish_video,
            mcp_tools::mcp_tool_read_screen_context,
        ])
        .setup(|app| {
            #[cfg(not(mobile))]
            setup_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
