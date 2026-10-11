// KeyDriver Lite 桌面外壳入口（阶段 B）：注册 hidapi 原生 HID 桥 commands。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hid;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            hid::hid_list,
            hid::hid_open,
            hid::hid_transfer,
            hid::hid_close,
            hid::hid_feature_get,
            hid::hid_feature_send,
            hid::debug_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
