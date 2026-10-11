# KeyDriver Lite

**3.5 MB** 的键盘配置工具：Tauri v2 + Rust hidapi 原生 HID 桥，无需浏览器授权，插上键盘即用。

> 与主版 [keydriver](https://github.com/baoru0908/keydriver) 同源同 UI：
> 功能与协议实现完全一致，差异只在**外壳与分发体积**——主版走 Electron + WebHID，
> Lite 走 Tauri v2 + 原生 hidapi（阶段 B），体积从 Electron 版的 ~223M 降到 **3.5M（约 -98%）**。

## 两版对照

| 项 | 主版 KeyDriver | Lite |
| --- | --- | --- |
| 外壳 | Electron（Chromium） | **Tauri v2（系统 WebKit）** |
| HID 通道 | WebHID（需点击授权） | **原生 hidapi 桥（免授权）** |
| 设备识别 | 浏览器授权列表 | 直读总线，**支持热插拔自动重连** |
| macOS .app 体积 | ~288M（裁剪后 ~223M） | **3.5M** |
| 安装包 | .dmg（Electron builder） | **.dmg 2.5M（自定义界面）** |
| 平台 | macOS / Windows / Linux | macOS（Apple Silicon）已发布；Windows 规划中 |
| appId | `com.keydriver.app` | `com.keydriver.lite` |

## 能力

- **键位编辑**：多层键映射，VIA V3 定义文件驱动（含本地定义库，按 VID/PID 自动匹配）
- **灯光/菜单**：QMK 标准语义——brightness / effect / effect_speed / **color = [hue, sat] 两字节**（与 VIA 官方一致）
- **读优先**：连接后读取设备当前配置并呈现，**不做任何写入**
- **自动落盘**：改动后空闲 1.5s 自动写 EEPROM（VIA 的 SET 只改 RAM，不落盘则每次开机配置丢失）
- **热插拔**：未连接时 2s 轮询总线，键盘插入即出现；记忆设备自动重连（强制 VIA usage 匹配，不会连到打字接口）
- **断连感知**：1s 轮询 + 传输失败兜底，拔出即进入 lost 态并保留脏值
- **宏 / 布局选项 / 备份导出导入 / EEPROM 复位 / 撤销**

## 快速开始

```bash
npm install
source ~/.cargo/env          # Rust 工具链
npx tauri dev                # 开发运行（Tauri 窗口 + Vite HMR）
```

首次 `cargo` 构建约 20 分钟（~500 crates），之后增量约 10 秒。

```bash
npm run check                                 # 硬编码守卫 + tsc
npx vitest run --maxWorkers=1 --minWorkers=1  # 串行测试（必须串行）
npx tauri build                               # 出 release 包（.app）
python3 scripts/dmg/make-dmg.py 0.1.0         # 出自定义界面 .dmg
```

## 安装器

`scripts/dmg/`：

- `dmg-background.svg/png`：660×400 深色背景（含拖拽指示箭头）
- `make-dmg.py`：用 `dmgbuild` 生成带布局的 DMG（左 App / 右 Applications）

```bash
pip install dmgbuild
python3 scripts/dmg/make-dmg.py 0.1.0
```

> 不走 Finder AppleScript 布局：macOS「自动化」权限未授权时会直接失败（error -10004）。
> dmgbuild 直接写 `.DS_Store`，无权限依赖，可进 CI。

## 结构

```
src/core/hid/         传输层（WebHidTransport / NativeHidTransport / Dummy 模拟固件）
src-tauri/src/hid.rs  原生 HID 桥：list/open/transfer/close/feature + 断连与热插拔轮询
src/core/protocol/    VIA V3 协议编解码、值宽度推断
src/definition/       定义文件解析、菜单扁平化、本地定义库
src/store/            zustand 状态（设备 / 键位 / 菜单 / 调试）
src/ui/               界面（布局 / 菜单控件 / 键位 / 调试面板）
probe/                真机诊断二进制（R1 探针 + 设备级读写诊断）
scripts/dmg/          安装器素材与脚本
```

## 诊断

```bash
KEYDRIVER_HID_LOG=1 npx tauri dev   # 收发帧 + 事件落盘到 /tmp/keydriver-hid.log
cargo run --bin via-hid-probe       # 独立枚举探针（只读）
cargo run --bin diag -- --write     # 设备级读写往返诊断
```

## 已知限制

- DMG 为 ad-hoc 自签名：别的 Mac 首次打开需右键「打开」放行；正式分发要配 Developer ID 签名 + 公证。
- 首次运行需导入一次定义文件（之后持久化在本地定义库）。
- 窗口级拖放已关闭（修复滑块拖拽被原生拖放处理器劫持），导入定义请走文件选择对话框。
- 当前只出 arm64 构建；x64 Mac 与 Windows 待补。
