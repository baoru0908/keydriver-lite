// KeyDriver Lite 原生 HID 桥（阶段 B，DoD②③）。
//
// 与前端 NativeHidTransport 对接的 6 个 command：
//   hid_list / hid_open / hid_transfer / hid_close / hid_feature_get / hid_feature_send
//
// 字节语义（探针 R1 实测 + SIZE-REDUCTION-EVAL §4.3 差异表）：
//   · 写：hidapi 需 33 字节 = [0x00 report-id 前缀] + 32 字节 VIA 帧（差异 #1）
//   · 读：本固件（EC_BM60 v12）hidapi 返回 32 字节、无 report-id 前缀，
//     首字节即命令码回显（差异 #2 实测不存在）；若遇到 33 字节读出则剥首字节，双兼容
//   · 断连：读写失败后重查 enumerate，路径消失 → emit "hid://disconnect"（R3 的兜底策略）
//   · 串行化：前端 SerialQueue 保证单飞，Rust 侧仅持互斥锁防 IPC 并发
use hidapi::{HidApi, HidDevice};
use serde::Serialize;
use std::sync::{LazyLock, Mutex, MutexGuard};
use tauri::{AppHandle, Emitter};

const VIA_USAGE_PAGE: u16 = 0xff60;
const VIA_USAGE: u16 = 0x61;
const MSG_LEN: usize = 32;

/// 传给前端的设备描述（字段与 HidDeviceInfo 对齐）
#[derive(Serialize, Clone)]
pub struct NativeDeviceInfo {
    pub path: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub product_name: String,
    pub manufacturer_name: Option<String>,
    pub serial_number: Option<String>,
    pub usage_page: u16,
    pub usage: u16,
    pub via_capable: bool,
}

struct OpenedDevice {
    device: HidDevice,
    path: String,
}

/// HidApi 必须比由它 open 出的 HidDevice 活得久 → 全局静态持有。
static HID_API: LazyLock<Mutex<HidApi>> = LazyLock::new(|| Mutex::new(HidApi::new().expect("HidApi init")));
static OPENED: Mutex<Option<OpenedDevice>> = Mutex::new(None);

fn opened_guard() -> MutexGuard<'static, Option<OpenedDevice>> {
    OPENED.lock().expect("OPENED poisoned")
}

/// 错误串约定（前端据此映射 TimeoutError / DisconnectedError）：
///   "TIMEOUT:<msg>" / "DISCONNECT:<msg>" / "ERROR:<msg>"
fn err(kind: &str, msg: impl Into<String>) -> String {
    format!("{kind}:{}", msg.into())
}

/// 帧级落盘日志（env 门控）：KEYDRIVER_HID_LOG=1 时把每次 tx/rx 追加到 /tmp/keydriver-hid.log，
/// 用于真机定位滑块/写入链路问题。不打开关零开销。
fn log_frame(dir: &str, bytes: &[u8], note: &str) {
    if std::env::var("KEYDRIVER_HID_LOG").map(|v| v != "1").unwrap_or(true) {
        return;
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
    let line = format!("{} {} {} {}\n", ts, dir, hex, note);
    write_log_line(&line);
}

/// 前端诊断通道：写纯文本行（前端 invoke debug_note，env 门控同上）。
fn write_log_line(line: &str) {
    if std::env::var("KEYDRIVER_HID_LOG").map(|v| v != "1").unwrap_or(true) {
        return;
    }
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("/tmp/keydriver-hid.log") {
        let _ = f.write_all(line.as_bytes());
    }
}

#[tauri::command(async)]
pub fn debug_note(text: String) -> Result<(), String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    write_log_line(&format!("{ts} NOTE {text}\n"));
    Ok(())
}

/// 打开失败/读写失败后复查设备是否还在总线上；不在则视为断连并广播。
fn emit_if_gone(app: &AppHandle, path: &str) -> bool {
    let gone = {
        let api = HID_API.lock().expect("HID_API poisoned");
        let present = api.device_list().any(|d| d.path().to_string_lossy() == path);
        !present
    };
    if gone {
        *opened_guard() = None;
        let _ = app.emit("hid://disconnect", path);
    }
    gone
}

/// R3：hidapi 无热插拔事件 → 打开期间每秒轮询一次 enumerate。
/// 路径从总线消失 → 清理连接状态并广播 hid://disconnect。
/// 传输失败兜底（emit_if_gone）仍然保留，双保险。
fn spawn_disconnect_poller(app: AppHandle, path: String) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(1000));
        // 已关闭或换设备了 → 轮询线程自然退出（emit 责任交给当前持有者）
        let still_mine = opened_guard().as_ref().map(|o| o.path == path).unwrap_or(false);
        if !still_mine {
            return;
        }
        let present = {
            let api = HID_API.lock().expect("HID_API poisoned");
            let found = api.device_list().any(|d| d.path().to_string_lossy() == path);
            found
        };
        if !present {
            *opened_guard() = None;
            log_frame("EVT", path.as_bytes(), "poll-disconnect");
            let _ = app.emit("hid://disconnect", path);
            return;
        }
    });
}

#[tauri::command(async)]
pub fn hid_list() -> Result<Vec<NativeDeviceInfo>, String> {
    let api = HID_API.lock().map_err(|_| err("ERROR", "HidApi 互斥锁中毒"))?;
    let mut out: Vec<NativeDeviceInfo> = Vec::new();
    for d in api.device_list() {
        let is_via = d.usage_page() == VIA_USAGE_PAGE && d.usage() == VIA_USAGE;
        // 只报 VIA 接口 + 标准键盘/制造商接口之外的原始接口都收，过滤交给前端 viaFilter
        out.push(NativeDeviceInfo {
            path: d.path().to_string_lossy().into_owned(),
            vendor_id: d.vendor_id(),
            product_id: d.product_id(),
            product_name: d.product_string().unwrap_or("未命名 HID 设备").to_string(),
            manufacturer_name: d.manufacturer_string().map(|s| s.to_string()),
            serial_number: d.serial_number().map(|s| s.to_string()),
            usage_page: d.usage_page(),
            usage: d.usage(),
            via_capable: is_via,
        });
    }
    Ok(out)
}

#[tauri::command(async)]
pub fn hid_open(app: AppHandle, path: String) -> Result<NativeDeviceInfo, String> {
    // 幂等：已打开同一路径直接返回
    {
        let opened = opened_guard();
        if let Some(o) = opened.as_ref() {
            if o.path == path {
                let api = HID_API.lock().map_err(|_| err("ERROR", "HidApi 互斥锁中毒"))?;
                if let Some(info) = find_info(&api, &path) {
                    return Ok(info);
                }
            }
        }
    }
    // 打开一次，同时取回设备信息（HidApi 必须比 HidDevice 活得久，故 api 持全局静态）
    let (dev, info) = {
        let api = HID_API.lock().map_err(|_| err("ERROR", "HidApi 互斥锁中毒"))?;
        let cpath = std::ffi::CString::new(path.as_str()).map_err(|_| err("ERROR", "path 含非法字节"))?;
        let dev = api
            .open_path(&cpath)
            .map_err(|e| err("DISCONNECT", format!("打开失败（可能被系统或其它工具占用）：{e}")))?;
        let info = find_info(&api, &path).ok_or_else(|| err("DISCONNECT", "打开后枚举不到该设备（已被拔出？）"))?;
        (dev, info)
    };
    *opened_guard() = Some(OpenedDevice { device: dev, path: path.clone() });
    log_frame("EVT", path.as_bytes(), "opened");
    spawn_disconnect_poller(app, path);
    Ok(info)
}

fn find_info(api: &HidApi, path: &str) -> Option<NativeDeviceInfo> {
    api.device_list().find_map(|d| {
        if d.path().to_string_lossy() != path {
            return None;
        }
        Some(NativeDeviceInfo {
            path: path.to_string(),
            vendor_id: d.vendor_id(),
            product_id: d.product_id(),
            product_name: d.product_string().unwrap_or("未命名 HID 设备").to_string(),
            manufacturer_name: d.manufacturer_string().map(|s| s.to_string()),
            serial_number: d.serial_number().map(|s| s.to_string()),
            usage_page: d.usage_page(),
            usage: d.usage(),
            via_capable: d.usage_page() == VIA_USAGE_PAGE && d.usage() == VIA_USAGE,
        })
    })
}

#[tauri::command(async)]
pub fn hid_close() -> Result<(), String> {
    if let Some(o) = opened_guard().take() {
        // hidapi 无显式 close；drop 即关闭。显式重置由 drop 完成。
        drop(o.device);
    }
    Ok(())
}

/// 同步请求-响应：写 32 字节 VIA 帧（内部补 0x00 前缀），读回 32 字节响应。
/// async：Tauri 同步 command 跑在主线程，阻塞 read_timeout 会卡死 UI——必须放异步运行时。
#[tauri::command(async)]
pub fn hid_transfer(app: AppHandle, request: Vec<u8>, timeout_ms: Option<u32>) -> Result<Vec<u8>, String> {
    let mut guard = opened_guard();
    let o = guard.as_mut().ok_or_else(|| err("DISCONNECT", "设备未打开"))?;

    // 写：33 字节 = 0x00 前缀 + 32 字节帧（差异 #1）
    let mut frame = [0u8; MSG_LEN];
    for (i, b) in request.iter().take(MSG_LEN).enumerate() {
        frame[i] = *b;
    }
    let mut out = [0u8; MSG_LEN + 1];
    out[0] = 0x00;
    out[1..].copy_from_slice(&frame);

    if let Err(e) = o.device.write(&out) {
        log_frame("TX", &out, "write-err");
        let path = o.path.clone();
        drop(guard);
        if emit_if_gone(&app, &path) {
            return Err(err("DISCONNECT", format!("写入失败且设备已消失：{e}")));
        }
        return Err(err("ERROR", format!("写入失败：{e}")));
    }
    log_frame("TX", &out, "");

    // 读：先按 33 收（兼容带 report-id 的固件），33 → 剥首字节；32 → 原样（探针实测本固件即此形态）
    let timeout = timeout_ms.unwrap_or(1000).clamp(1, 30_000) as i32;
    let mut buf = [0u8; MSG_LEN + 1];
    match o.device.read_timeout(&mut buf, timeout) {
        Ok(n) if n == 0 => {
            log_frame("RX", &buf, "timeout-0bytes");
            Err(err("TIMEOUT", "固件响应超时"))
        }
        Ok(n) => {
            let data: &[u8] = if n == MSG_LEN + 1 { &buf[1..] } else { &buf[..n] };
            let mut resp = [0u8; MSG_LEN];
            let take = data.len().min(MSG_LEN);
            resp[..take].copy_from_slice(&data[..take]);
            log_frame("RX", &resp, "");
            Ok(resp.to_vec())
        }
        Err(e) => {
            log_frame("RX", &buf, "read-err");
            let path = o.path.clone();
            drop(guard);
            if emit_if_gone(&app, &path) {
                return Err(err("DISCONNECT", format!("读取失败且设备已消失：{e}")));
            }
            Err(err("TIMEOUT", format!("读取失败：{e}")))
        }
    }
}

/// feature report 能力预留（DoD③）：本应用协议全走 output/input report，
/// 但 VIA 部分固件命令可能走 feature report，桥必须具备收发能力。
#[tauri::command(async)]
pub fn hid_feature_get(app: AppHandle, report_id: u8, buf_len: Option<u16>) -> Result<Vec<u8>, String> {
    let mut guard = opened_guard();
    let o = guard.as_mut().ok_or_else(|| err("DISCONNECT", "设备未打开"))?;
    let len = buf_len.unwrap_or(MSG_LEN as u16).max(1) as usize;
    let mut buf = vec![report_id; len + 1];
    match o.device.get_feature_report(&mut buf) {
        Ok(n) if n > 0 => {
            // 与 read 同规则：首字节为 report-id 时剥掉
            let data: &[u8] = if n == len + 1 { &buf[1..n] } else { &buf[..n] };
            Ok(data.to_vec())
        }
        Ok(_) => Err(err("TIMEOUT", "feature report 读回 0 字节（固件可能不支持该 report-id）")),
        Err(e) => {
            let path = o.path.clone();
            drop(guard);
            if emit_if_gone(&app, &path) {
                return Err(err("DISCONNECT", format!("feature 读失败且设备已消失：{e}")));
            }
            Err(err("ERROR", format!("feature report 读失败：{e}")))
        }
    }
}

#[tauri::command(async)]
pub fn hid_feature_send(app: AppHandle, report_id: u8, data: Vec<u8>) -> Result<(), String> {
    let mut guard = opened_guard();
    let o = guard.as_mut().ok_or_else(|| err("DISCONNECT", "设备未打开"))?;
    let mut buf = Vec::with_capacity(data.len() + 1);
    buf.push(report_id);
    buf.extend_from_slice(&data);
    match o.device.send_feature_report(&buf) {
        Ok(_) => Ok(()),
        Err(e) => {
            let path = o.path.clone();
            drop(guard);
            if emit_if_gone(&app, &path) {
                return Err(err("DISCONNECT", format!("feature 写失败且设备已消失：{e}")));
            }
            Err(err("ERROR", format!("feature report 写失败：{e}")))
        }
    }
}
