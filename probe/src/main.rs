// KeyDriver Lite 阶段B R1 真机探针（SIZE-REDUCTION-EVAL §7 R1 / HANDOVER DoD①）
// 流程：hidapi 枚举 → 过滤 usagePage=0xFF60/usage=0x61 → open → GET_PROTOCOL_VERSION 只读往返
// 纪律：只发 GET 命令（0x01），绝不写设备。退出码 0 = R1-PASS，非 0 = R1-FAIL。

use hidapi::HidApi;
use std::process::ExitCode;

const VIA_USAGE_PAGE: u16 = 0xff60;
const VIA_USAGE: u16 = 0x61;
const MSG_LEN: usize = 32;
const TIMEOUT_MS: i32 = 500;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ")
}

fn main() -> ExitCode {
    println!("== KeyDriver Lite 阶段B R1 真机探针 ==");
    println!("目标：hidapi 枚举并打开 usagePage=0xFF60 / usage=0x61（只读探测，GET 命令，不写设备）\n");

    // ① hidapi 初始化
    let api = match HidApi::new() {
        Ok(api) => api,
        Err(e) => {
            eprintln!("[FAIL] ① HidApi 初始化失败：{e}");
            return ExitCode::FAILURE;
        }
    };

    // ② 枚举全部 HID 接口
    let all: Vec<_> = api.device_list().collect();
    println!("① HidApi 初始化 OK；枚举到 {} 个 HID 接口", all.len());

    // ③ 过滤 VIA RAW HID usage
    let matches: Vec<_> = all
        .iter()
        .filter(|d| d.usage_page() == VIA_USAGE_PAGE && d.usage() == VIA_USAGE)
        .collect();

    if matches.is_empty() {
        println!("② 未发现 VIA RAW HID 接口 (0xFF60/0x61)。当前全部接口：");
        for d in &all {
            println!(
                "    vid=0x{:04x} pid=0x{:04x} usage_page=0x{:04x} usage=0x{:02x} product={:?}",
                d.vendor_id(),
                d.product_id(),
                d.usage_page(),
                d.usage(),
                d.product_string(),
            );
        }
        println!("[R1-FAIL] 无 VIA 接口。排查：①键盘/USB 线已插稳 ②固件是否启用 VIA ③是否被 VIA/其它配置工具独占");
        return ExitCode::FAILURE;
    }

    println!(
        "② 命中 {} 个 VIA RAW HID 接口（期望 VID=0x5594 / PID=0x0005 即 Em60）：",
        matches.len()
    );
    for d in &matches {
        println!(
            "    vid=0x{:04x} pid=0x{:04x} product={:?} serial={:?} path={}",
            d.vendor_id(),
            d.product_id(),
            d.product_string(),
            d.serial_number(),
            d.path().to_string_lossy(),
        );
    }

    // ④ 逐个 open + GET_PROTOCOL_VERSION 只读往返
    let mut opened = 0;
    let mut roundtrip_ok = 0;
    for info in &matches {
        let path = info.path();
        println!("③ 尝试 open path={} ...", path.to_string_lossy());
        let dev = match api.open_path(path) {
            Ok(dev) => {
                opened += 1;
                println!("    [OK] open 成功（无需 SeizeDevice 兜底）");
                dev
            }
            Err(e) => {
                println!("    [FAIL] open 失败：{e}");
                println!("    → 结论候选：接口被系统/其它进程占用，需评估 IOKit kIOHIDOptionsTypeSeizeDevice 兜底");
                continue;
            }
        };
        if let Ok(Some(m)) = dev.get_manufacturer_string() {
            println!("    manufacturer: {m}");
        }
        if let Ok(Some(p)) = dev.get_product_string() {
            println!("    product:      {p}");
        }

        // ⑤ 只读往返：GET_PROTOCOL_VERSION（32 字节帧，命令码 0x01）
        let mut req = [0u8; MSG_LEN];
        req[0] = 0x01;
        // hidapi 写：首字节 report ID 前缀（0x00）+ 32 字节 → 共 33 字节（语义差异表 #1）
        let mut out = [0u8; MSG_LEN + 1];
        out[0] = 0x00;
        out[1..].copy_from_slice(&req);

        match dev.write(&out) {
            Ok(n) if n == out.len() => println!("    [OK] write 33 字节成功（0x00 前缀 + GET_PROTOCOL_VERSION）"),
            Ok(n) => {
                println!("    [FAIL] write 只写入 {n}/{} 字节", out.len());
                continue;
            }
            Err(e) => {
                println!("    [FAIL] write 失败：{e}");
                continue;
            }
        }

        let mut buf = [0u8; MSG_LEN];
        match dev.read_timeout(&mut buf, TIMEOUT_MS) {
            Ok(n) if n > 0 => {
                // hidapi 读：首字节即 report ID，VIA 响应无 report ID 时固件回帧仍是 32 字节
                // （语义差异表 #2：先原样打印，剥不剥由响应首字节是否 = 命令码回显判定）
                let rx = &buf[..n];
                println!("    [OK] read {n} 字节：{}", hex(rx));
                let data = if rx[0] == 0x01 { rx } else { &rx[1..] };
                if data.first() == Some(&0x01) {
                    let be = u16::from_be_bytes([data[2], data[3]]);
                    let alt = u16::from_be_bytes([data[1], data[2]]);
                    let (version, via) = if be < 0x0100 { (be, "data[2..4]") } else { (alt, "data[1..3] 方言兜底") };
                    println!("    [PASS] 协议版本 = v{version}（解析自 {via}）——固件回话了，读写链路全通");
                    roundtrip_ok += 1;
                } else {
                    println!("    [WARN] 响应首字节非命令码回显：{}", hex(rx));
                }
            }
            Ok(_) => println!("    [FAIL] read 超时（{TIMEOUT_MS}ms，0 字节）——写入通了但固件无响应"),
            Err(e) => println!("    [FAIL] read 失败：{e}"),
        }
    }

    // ⑥ 结论
    println!("\n== R1 结论 ==");
    println!("匹配 {}/枚举 {} /open 成功 {}/往返成功 {}", matches.len(), all.len(), opened, roundtrip_ok);
    if roundtrip_ok > 0 {
        println!("[R1-PASS] 原生 hidapi 可枚举、可打开、可与 VIA 固件完成真实往返。阶段 B 唯一硬门槛已过 ✅");
        println!("SeizeDevice 兜底结论：本次不需要（open 均成功）。");
        ExitCode::SUCCESS
    } else if opened > 0 {
        println!("[R1-FAIL] open 成功但读写往返全失败——检查 report 长度语义/固件状态，把上面完整输出发回。");
        ExitCode::FAILURE
    } else {
        println!("[R1-FAIL] 枚举命中但全部 open 失败——大概率被占用，下一步写 IOKit SeizeDevice 探针再验。");
        ExitCode::FAILURE
    }
}
