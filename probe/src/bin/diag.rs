// 设备级诊断：复现 App 的完整命令序列（握手 → 自定义值 GET/SET），定位滑块锁死问题。
// 用法：cargo run --bin diag            → 只读（GET 序列）
//       cargo run --bin diag -- --write → 额外做一次 brightness SET 200 写读往返
use hidapi::HidApi;
use std::time::Duration;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ")
}

fn main() {
    let do_write = std::env::args().any(|a| a == "--write");
    println!("== 桥设备级诊断（write={do_write}）==");

    let api = HidApi::new().expect("HidApi");
    let info = api
        .device_list()
        .find(|d| d.usage_page() == 0xff60 && d.usage() == 0x61)
        .expect("未找到 VIA 设备，请插好键盘");
    println!("设备：vid=0x{:04x} pid=0x{:04x} path={}", info.vendor_id(), info.product_id(), info.path().to_string_lossy());
    let dev = api.open_path(info.path()).expect("open 失败");
    println!("[1] open OK");

    // 与 NativeHidTransport 相同的字节规则：写 33 字节（0x00 前缀 + 32 帧），读 32 字节
    let exchange = |label: &str, frame: [u8; 32], timeout_ms: i32| -> Option<Vec<u8>> {
        let mut out = [0u8; 33];
        out[0] = 0x00;
        out[1..].copy_from_slice(&frame);
        if let Err(e) = dev.write(&out) {
            println!("  {label} 写失败：{e}");
            return None;
        }
        let mut buf = [0u8; 33];
        match dev.read_timeout(&mut buf, timeout_ms) {
            Ok(n) if n > 0 => {
                let data: &[u8] = if n == 33 { &buf[1..] } else { &buf[..n] };
                println!("  {label} tx={} rx({n})={}", hex(&frame), hex(data));
                Some(data.to_vec())
            }
            Ok(_) => {
                println!("  {label} tx={} 超时（0 字节）", hex(&frame));
                None
            }
            Err(e) => {
                println!("  {label} 读失败：{e}");
                None
            }
        }
    };

    // [2] 握手：GET_PROTOCOL_VERSION (0x01)
    let mut f = [0u8; 32];
    f[0] = 0x01;
    exchange("[2] GET_VERSION", f, 500);

    // [3] CUSTOM_GET_VALUE (0x08) channel 3：valueId 1 = brightness，valueId 3 = effect speed，valueId 2 = effect（对照组，已知正常）
    for vid in [2u8, 1, 3] {
        let mut f = [0u8; 32];
        f[0] = 0x08;
        f[1] = 0x03;
        f[2] = vid;
        exchange(&format!("[3] GET ch3/v{vid}"), f, 500);
    }

    if do_write {
        // [4] CUSTOM_SET_VALUE (0x07) brightness = 200（1 字节宽度），再 GET 回读
        let mut f = [0u8; 32];
        f[0] = 0x07;
        f[1] = 0x03;
        f[2] = 0x01;
        f[3] = 0xC8;
        exchange("[4] SET ch3/v1=200", f, 500);
        let mut f = [0u8; 32];
        f[0] = 0x08;
        f[1] = 0x03;
        f[2] = 0x01;
        exchange("[4] GET ch3/v1 回读", f, 500);
    }

    // [5] 连续两次 GET 间隔（模拟 UI 快速操作节奏）
    for _ in 0..2 {
        let mut f = [0u8; 32];
        f[0] = 0x08;
        f[1] = 0x03;
        f[2] = 0x02;
        exchange("[5] GET ch3/v2", f, 500);
        std::thread::sleep(Duration::from_millis(120));
    }

    println!("== 诊断完成 ==");
}
