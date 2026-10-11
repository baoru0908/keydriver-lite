// 拖拽轮询桥：本环境 WKWebView 在鼠标按住拖动期间不派发 mousemove/pointermove
// （真机帧日志实证：Radix pointer capture、window pointermove 全部只有 click 级响应），
// JS 层拿不到连续坐标 → 由原生侧轮询 NSEvent.mouseLocation，16ms 一帧推给前端。
// X 轴两侧坐标方向一致（左→右），前端换算：clientX = x − window.screenX（points 与 CSS px 同单位）。
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Emitter;

static DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);
static DRAG_LOCK: Mutex<()> = Mutex::new(());

#[cfg(target_os = "macos")]
mod mac {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;
    use objc2_core_foundation::CGPoint;

    /// NSEvent.mouseLocation 类方法（屏幕坐标，原点在主屏左下角，单位 points）。
    pub fn mouse_location() -> Option<CGPoint> {
        let cls = AnyClass::get(c"NSEvent")?;
        // SAFETY：无参类方法，返回 NSPoint（与 CGPoint 同布局）
        let pt: CGPoint = unsafe { msg_send![cls, mouseLocation] };
        Some(pt)
    }
}

#[tauri::command(async)]
pub fn slider_drag_begin(app: tauri::AppHandle) -> Result<(), String> {
    let _guard = DRAG_LOCK.lock().map_err(|_| "drag lock poisoned")?;
    if DRAG_ACTIVE.swap(true, Ordering::SeqCst) {
        return Ok(()); // 已有会话进行中，前端复用即可
    }
    #[cfg(target_os = "macos")]
    {
        std::thread::spawn(move || {
            let started = Instant::now();
            while DRAG_ACTIVE.load(Ordering::SeqCst) {
                if let Some(pt) = mac::mouse_location() {
                    let _ = app.emit("slider://drag", pt.x);
                }
                if started.elapsed() > Duration::from_secs(60) {
                    break; // 防泄漏兜底（正常由 slider_drag_end 终止）
                }
                std::thread::sleep(Duration::from_millis(16));
            }
            DRAG_ACTIVE.store(false, Ordering::SeqCst);
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        DRAG_ACTIVE.store(false, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command(async)]
pub fn slider_drag_end() -> Result<(), String> {
    DRAG_ACTIVE.store(false, Ordering::SeqCst);
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::mac::mouse_location;

    #[test]
    fn mouse_location_returns_plausible_screen_point() {
        let pt = mouse_location().expect("NSEvent.mouseLocation 应可用");
        assert!(
            pt.x > -20_000.0 && pt.x < 20_000.0 && pt.y > -20_000.0 && pt.y < 20_000.0,
            "坐标应在合理屏幕范围内，实际 {pt:?}",
        );
    }
}
