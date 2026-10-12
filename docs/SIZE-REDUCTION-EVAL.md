# KeyDriver 包体瘦身：技术路径评估

> 评估日期：2026-10-11 ｜ 对象：`keydriver/`（Electron + Vite + React 19 桌面应用）
> 目标：**功能不变**的前提下显著缩小体积

---

## 0. 结论摘要（TL;DR）

1. **体积不是一个"打包配置"问题，而是一个"运行时选型"问题。**
   288M 产物里，Electron/Chromium 运行时占 **287M（99.8%）**，我们自己的代码 + 前端产物只有 **约 0.7M**。
   → 任何在 Electron 内部的优化，理论上限只有 **-28%**（288M → 约 206M），够不上"显著"。

2. **唯一能显著缩小体积的路径是"换 WebView 外壳"**：从「内置 Chromium」换成「系统 WebView」。
   候选：**Tauri v2**（Rust）/ Wails v3（Go）/ Neutralino。
   其中 **Tauri v2 的 macOS dmg 约 5–15M，相对现状缩减 ~95%+**。

3. **唯一的拦路虎是 WebHID**：`WebHID` 只有桌面 Chromium 实现；macOS 的 WKWebView（Tauri 用）**不支持且 WebKit 官方明确反对**。
   → 这正是本项目当初选 Electron 的原因（见 `docs/ELECTRON.md` 第一节）。

4. **破解办法已经现成**：本项目的传输层早已抽象成 `HidTransport` 接口（`DummyTransport` / `WebHidTransport` 两个实现，`TransportKind` 甚至已预留 `'nodehid'`）。
   → 迁移只需**新增第三个实现**（Rust `hidapi` 桥），**UI、协议层、定义解析、菜单引擎等 100% 不动**。

5. **建议节奏**：
   - **阶段 A（0.5 天，零风险）**：Electron 产物裁剪，**288M → 约 220M（-23%）**，立刻见效。
   - **阶段 B（1–2 周）**：Tauri v2 外壳 + 原生 HID 桥，**288M → 约 10M（-96%）**，根本解决。
   - 两阶段不冲突：A 可立即上线，B 完成后 A 的裁剪脚本即废弃。

---

## 1. 体积现状解剖（实测）

```
keydriver/release/KeyDriver.app                              288 M   ← 100%
├── Contents/Frameworks/Electron Framework.framework         285 M   ← 99.0%
│   ├── Versions/A/Electron Framework（二进制，Chromium 内核） 192 M   ← 66.7%  ★不可裁
│   ├── Versions/A/Resources/*.lproj（659 个语言包文件）        49 M   ← 17.0%  ✅可裁
│   ├── Versions/A/Libraries/libvk_swiftshader.dylib           16 M   ← 5.6%   ⚠️条件可裁
│   ├── Versions/A/Resources/resources.pak                     12 M   ← 4.2%
│   ├── Versions/A/Resources/icudtl.dat                        10 M   ← 3.5%   ⚠️条件可裁
│   ├── Versions/A/Resources/chrome_200_percent.pak           1.2 M
│   └── Versions/A/Libraries/libffmpeg.dylib                  2.2 M   ← 0.8%   ✅可裁
├── Contents/Resources                                         1 M
│   ├── app/（main.cjs + package.json）                        12 K
│   └── dist/（我们的 React 前端构建产物）                      680 K   ← 0.24%
└── Contents/MacOS、Info.plist、CodeSignature 等               ~40 K
```

**关键事实**：`.app` 288M 是未压缩目录；打成 dmg 后约 90–110M（压缩率约 60%）。所以"包体"若指分发文件，现状是 ~100M。

---

## 2. 为什么"换壳"是唯一显著路径

把 288M 拆成两部分：

| 部分 | 体积 | 能否压缩 |
| --- | --- | --- |
| **Electron/Chromium 运行时**（内核、ICU、locale、软渲染、媒体库） | **287 M** | 只能裁掉外围（locale/swiftshader/ffmpeg），**内核 192M 不可裁** |
| **KeyDriver 自有代码**（149 个 ts/tsx、18,848 行 + 前端产物） | **0.7 M** | 已是最优，无可压缩空间 |

结论：
- Electron 官方**不提供**内核裁剪能力（无 custom build），`electron-builder` / 手工组装都动不了那 192M。
- 因此"缩小体积"的本质 = **不再分发 Chromium**，改用操作系统自带的 WebView。

---

## 3. 候选技术路径矩阵

| 方案 | macOS 体积 | Windows 体积 | WebHID | 前端复用 | 迁移成本 | 风险 |
| --- | --- | --- | --- | --- | --- | --- |
| **0. 现状 Electron** | 288 M（dmg ~100M） | ~180 M | ✅ 原生支持 | — | — | — |
| **A. Electron 产物裁剪** | **~220 M**（dmg ~80M） | ~140 M | ✅ 不变 | 100% | **0.5 天** | 低 |
| **B. Tauri v2 + Rust hidapi** ⭐ | **~5–15 M** | ~3–6 M | 自研桥（Rust） | 100% | **1–2 周** | 中（macOS HID 独占） |
| **C. Wails v3 + Go hid** | ~15–25 M | ~8–12 M | 自研桥（Go） | 100% | 1–2 周 | 中 |
| **D. Neutralino.js** | ~3–5 M | ~3–5 M | 自研（无官方桥） | 100% | 2–3 周 | 高（生态弱） |
| **E. 纯原生重写**（SwiftUI / Qt / egui） | ~2–5 M | ~2–5 M | 原生 API | ❌ 需重写全部 UI | 极高 | 极高 |

**推荐 B**，理由：体积收益最大、Rust 侧 HID 生态成熟（`hidapi` crate）、Tauri v2 已支持 macOS/Windows/Linux 且可继续用 Vite 构建链。

> D（Neutralino）虽更小，但缺少成熟的 IPC 类型系统与 HID 生态，维护成本反而更高，不推荐。

---

## 4. 关键约束与破解：WebHID → 原生 HID

### 4.1 事实核查

| 环境 | 内核 | WebHID |
| --- | --- | --- |
| Electron | 内置 Chromium | ✅（需 `disable-hid-blocklist` + 三个主进程钩子，现行 `main.cjs` 已实现） |
| Windows WebView2 | Chromium（系统自带） | ✅ 理论支持（需宿主处理 `PermissionRequested`，待实测） |
| **macOS WKWebView**（Tauri/Wails 用） | WebKit | ❌ **不支持**，WebKit 已提交正式 `oppose` 立场（standards-positions #510） |
| Linux WebKitGTK | WebKit | ❌ 不支持 |

→ **macOS（当前第一优先级平台）换壳后必然失去 WebHID。**

### 4.2 现有架构已经为这件事铺好了路

`src/core/hid/HidTransport.ts` 定义的接口：

```ts
export type TransportKind = 'webhid' | 'nodehid' | 'dummy';
//                                              ^^^^^^^^ 已预留！

export interface HidTransport {
  isSupported(): boolean;
  listDevices(options?): Promise<HidDeviceInfo[]>;
  requestAccess?(options?): Promise<HidDeviceInfo[]>;
  open(info): Promise<void>;
  close(): Promise<void>;
  transfer(request: Uint8Array, timeoutMs?): Promise<Uint8Array>;
  onDisconnect(cb): Unsubscribe;
}
```

现有两个实现（`DummyTransport` 无硬件模拟、`WebHidTransport` 真实设备）共用一个接口，
所以 **`ViaProtocol` / `DeviceFacade` / 全部 UI 在有硬件与无硬件时跑的是同一份代码**。

**迁移工作量 = 新增第三个实现**（参考 `WebHidTransport.ts` 的 216 行）：

```
src/core/hid/NativeHidTransport.ts     ← 新前端实现（约 150–200 行）
  · listDevices()   → invoke('hid_list')
  · open()          → invoke('hid_open', { vid, pid, path })
  · transfer()      → invoke('hid_transfer', { report: number[] })  ← 32 字节帧
  · onDisconnect()  → listen('hid_disconnect')

src-tauri/src/hid.rs                   ← 新 Rust 侧（约 200–250 行）
  · hidapi::HidApi::new() 枚举 usage_page=0xFF60 / usage=0x61 的 RAW HID 接口
  · 打开、写 32 字节、阻塞读（带超时）、关闭
  · 设备热插拔事件 → emit 到前端
```

**不动**：`src/ui/**`（全部界面）、`src/store/**`、`src/definition/**`、`src/keycodes/**`、
`src/core/protocol/**`、`src/core/device/**`、`src/ui/menu/**`、`src/ui/macro/**`。

### 4.3 需注意的语义映射

| WebHID 语义 | 原生 HID 等价物 | 注意点 |
| --- | --- | --- |
| `requestDevice()` 用户手势授权 | Tauri 侧弹原生设备选择框 | 语义一致，改成 app 自己的选择器 |
| `sendReport(0, data)` | `device.write(0x00 + data)` | 原生写需要**前置 report ID 字节**（32 字节帧 → 33 字节 buf） |
| `inputreport` 事件 | 阻塞 `device.read()` 或 `read_timeout()` | 需在 Rust 侧做超时 + 串行化，与 `SerialQueue` 对齐 |
| `disconnect` 事件 | `hidapi` 无原生热插拔 → 轮询或 IOKit 通知 | 需要额外实现，简单做法是读写失败即判定断开 |

**⚠️ 不要直接用社区的 `tauri-plugin-hid`**：其 README 明确标注 **feature report 尚未实现**。
VIA 协议主路径虽是 output report（`sendReport`）+ input report（`inputreport`），但部分固件/命令会走
feature report（`sendFeatureReport` / `receiveFeatureReport`）。若用该插件，这类命令会直接失败。
→ **建议直接用 `hidapi` crate 自研桥**（约 200–250 行），一次覆盖 output / input / feature 三类 report，
   避免后期被插件能力卡住。这也解释了为何"用现成插件"看起来省事、实际风险更高。

### 4.4 协议兼容性：换 WebView 不会动到 VIA 协议

**先厘清两层**（这是"不兼容"这个担心能否成立的关键）：

| 层 | 内容 | 系统 WebView 是否参与 | 结论 |
| --- | --- | --- | --- |
| **VIA 应用层协议** | 32 字节 RAW HID 帧、命令码 `0x01–0x15`、握手、宏缓冲区、自定义值 | ❌ 完全不参与 | **不可能不兼容** |
| **WebHID 浏览器 API** | `navigator.hid` / `sendReport` / `inputreport` | ✅ 依赖 Chromium | macOS WKWebView 确实没有 |

**证据（全项目实测，ripgrep 扫描 `src/**`）**：真正触碰 WebHID 特有 API 的只有 **4 个文件**：

| 文件 | 触碰点 | 迁移处理 |
| --- | --- | --- |
| `src/core/hid/WebHidTransport.ts` | 整个文件（216 行） | **被替换**（新增 `NativeHidTransport.ts`） |
| `src/core/hid/viaFilter.ts:15` | 一处类型标注 `HIDDeviceFilter[]` | 改为自定义 filter 类型（字段名不变） |
| `src/ui/device/ConnectBanner.tsx:18` | 一句 `'hid' in navigator` 能力探测文案 | 改为按 transport kind 探测 |
| `src/ui/device/DevicePicker.tsx:37,47` | 能力探测 + `navigator.hid.getDevices()` | 走工厂接口即可 |

**`src/core/protocol/**`（845 行，含 `ViaProtocol.ts` 365 行）零命中 WebHID 标识**——
它只 `import type { HidTransport }` 与 `SerialQueue` / 错误类型 / `frame` 工具，
对外只看到 `transfer(request: Uint8Array): Promise<Uint8Array>`，即"32 字节进、32 字节出"。
`DummyTransport` 的存在本身就是证明：没有硬件时同一份协议代码照样跑通全链路。

> **换传输 = 换轮胎，协议是方向盘。** 方向盘不会因为换轮胎而改变。

#### 真正需要小心的是"字节语义对齐"（这才是"不兼容"的实质）

原生 HID 与 WebHID 在**字节层面有 5 处语义差异**，写错任何一处，表象都像"协议不兼容"：

| # | 差异点 | WebHID | hidapi 原生 | 写错的后果 |
| --- | --- | --- | --- | --- |
| 1 | **写：report ID** | `sendReport(0, data)`——ID 是**独立参数**，data 恰 32 字节 | `write()` 需把 ID 拼进首字节 → **必须写 33 字节**（`0x00` + 32） | 只发 32 字节 → 固件静默无响应（"发了没反应"） |
| 2 | **读：首字节** ⚠️最阴险 | `event.data` **不含** report ID（ID 在 `event.reportId`） | `read()` 返回的**首字节就是 report ID** | 不剥首字节 → 整个响应**错位 1 字节**，命令码与参数全乱 |
| 3 | **report 长度** | 固定 32 | 可能 33（含 ID）或 32（无 ID 设备），取决于 report descriptor | 长度判断错 → 截断或越界 |
| 4 | **feature report** | `sendFeatureReport` / `receiveFeatureReport` | `send_feature_report` / `get_feature_report`（同样有 ID 字节规则） | 插件不支持即废（见上文 tauri-plugin-hid 警告） |
| 5 | **读取模型** | 事件驱动 + `setTimeout` 超时 | 阻塞 `read_timeout()` | 需独立线程 + channel，并保证读到的就是本次请求的响应，否则多命令并发串包 |

第 1、2 条最危险：它们在 happy path 上"看起来能跑"（写返回成功、读返回数据），
只是数据错位，**不会立刻报错**，调试成本高。

**好消息：项目自带"方言错位"检测**，写错位不会静默把键盘改坏——
`src/core/hid/frame.ts` 提供三道护栏：

- `isUnhandled()` —— 首字节 `0xFF` = 固件不识别该命令
- `echoPrefixMatches()` —— 前缀比对，注释明确写道"命令码相同但帧格式不同时固件会原样回显，只有前缀比对能识别**方言错位**"
- `echoMatches()` —— 参数回声一致性校验

#### 等价性验收方案（建议照此执行）

`ViaProtocol` 已内置 `onFrame` 回调（`FrameRecord{ dir, hex, at, durationMs, commandId }`）。
→ 用 `DummyTransport` + `SimulatedFirmware` 跑一遍标准命令序列，再用原生桥在真机跑**同一序列**，
**逐帧 diff `tx` / `rx` 的 hex**。全等即协议等价，不等即定位到具体命令与字节偏移。
这是可自动化的验收，不依赖人眼。

#### 若某平台原生 HID 确实修不通：分层兜底

| 情形 | 退路 | 代价 |
| --- | --- | --- |
| Windows | WebView2 是 Chromium，`navigator.hid` 可强开 → **保留 WebHID 路径，该平台零改造** | 无 |
| macOS 原生 HID 打不开 | 平台分叉：macOS 出 Electron 版、Windows 出 Tauri 版 | 双构建链 |
| 全平台都不行 | 保留纯 Web / PWA 模式（Chrome 打开），WebHID 100% 原生可用 | 包体 ≈ 0，但分发依赖用户浏览器 |
| 最坏 | 放弃瘦身，留在 Electron | 协议永不受影响 |

**核心结论：协议能力在任何一条退路上都不会丢。** 这是"能不能瘦"的问题，不是"功能会不会坏"的问题。

#### 另需注意：Web 标准差异（与协议无关，但同样要回归）

- **CSS**：Tailwind v4 使用 `@property`、`color-mix()`、容器查询 → WKWebView macOS 12+ 支持良好，但需逐面板真机回归
- **文件拖拽导入**（`DefinitionDropzone`）：Tauri 的 drag-drop 事件与浏览器 `DataTransfer` 语义不同 → 需适配
- **IndexedDB**（`idb-keyval`）：WKWebView 支持，无影响
- **安全上下文** ⚠️：`ConnectBanner.tsx:15` 检查 `window.isSecureContext`。Tauri 使用自定义协议
  （`tauri://localhost`），**必须确认其被当作 secure context**，否则会误报"当前不是安全上下文"，
  并且 WebHID（若走浏览器兜底）会被禁用。这是迁移后第一个要验证的点。

---

## 5. 推荐方案与阶段计划

### 阶段 A：Electron 产物裁剪（立即执行，0.5 天，-23%）

在 `scripts/make-app.mjs` 第 3 步之后追加一个「裁减运行时」步骤（这是手工打包，完全可控）：

| 裁剪项 | 省下 | 做法 | 风险 |
| --- | --- | --- | --- |
| 非中英 locale（659 个 .lproj） | **约 47 M** | 只保留 `en.lproj`、`zh_CN.lproj` | 无（`package.json` 的 `electronLanguages` 已声明 en/zh，只是手工打包没实现） |
| `libvk_swiftshader.dylib` | **约 16 M** | 删除；必要时回退 | 无独显/虚拟机上 GPU 回退失效（本应用是纯 2D UI，风险低） |
| `libffmpeg.dylib` | **2.2 M** | 删除 | 应用无音视频需求，无影响 |
| `chrome_200_percent.pak` | 1.2 M | 视 Retina 表现决定 | 谨慎，建议保留 |
| **合计** | **约 65 M** | → **288M 降到约 223M（-23%）** | 低 |

> 注：裁剪后**必须重新 `codesign --force --deep`**（脚本第 5 步已有，顺序要放在裁剪之后），否则启动即退出。
> 同步修正 `package.json` 的 `electronLanguages` 使 electron-builder 路径（方式 B）也生效。

### 阶段 B：Tauri v2 迁移（根本解决，1–2 周，-96%）

```
keydriver/
├── src/                      # 不变（React 前端）
├── src-tauri/                # 新增
│   ├── Cargo.toml            # hidapi, tauri, serde
│   ├── tauri.conf.json       # 窗口配置、bundle 配置
│   └── src/
│       ├── main.rs           # 入口 + command 注册
│       └── hid.rs            # ★ 原生 HID 桥
├── src/core/hid/
│   └── NativeHidTransport.ts # ★ 新增第三个实现
└── electron/                 # 保留为过渡分支（可删）
```

关键动作：
1. `npm i -D @tauri-apps/cli @tauri-apps/api`，`npx tauri init`
2. 实现 `src-tauri/src/hid.rs`（`hidapi` crate）
3. 实现 `NativeHidTransport.ts`，在 `src/core/hid/index.ts` 的工厂里按 `kind === 'nodehid'` 分支接入
4. `tauri.conf.json` 的 `build.beforeBuildCommand = "npm run build"`，`frontendDist = "../dist"`
5. 处理文件拖拽导入（`DefinitionDropzone`）：Tauri 的 drag-drop 事件与浏览器 `DataTransfer` 语义不同，需适配
6. 产出：`KeyDriver.app` ~8–12M，dmg ~5–8M

---

## 6. 迁移影响面（阶段 B）

| 模块 | 是否改动 | 说明 |
| --- | --- | --- |
| `src/ui/**`（全部界面） | ❌ 不动 | React 19 + Tailwind v4 在 WKWebView 正常工作 |
| `src/store/**`（zustand + idb-keyval） | ❌ 不动 | WKWebView 支持 IndexedDB |
| `src/definition/**`、`src/keycodes/**` | ❌ 不动 | 纯逻辑 |
| `src/core/protocol/**`、`src/core/device/**` | ❌ 不动 | 依赖 `HidTransport` 接口，接口不变 |
| `src/core/hid/index.ts` | ✅ 小改 | 工厂增加 `nodehid` 分支 |
| `src/core/hid/NativeHidTransport.ts` | ✅ 新增 | 约 200 行 |
| `src-tauri/**` | ✅ 新增 | 约 300 行 Rust |
| `electron/`、`scripts/make-app.mjs` | ✅ 退役 | 阶段 A 的裁剪脚本一并删除 |

**前端 CSS 兼容性提醒**：Tailwind v4 使用现代 CSS（`@property`、`color-mix()`、容器查询等）。
WKWebView 在 macOS 12+ 支持度良好，但建议在真机逐个面板回归。

---

## 7. 风险清单与真机验证清单

| # | 风险 | 影响 | 验证方式 |
| --- | --- | --- | --- |
| R1 | **macOS 上 RAW HID 接口被系统驱动占用**，`hidapi.open()` 失败 | 致命（读不到键盘） | 用 `hidapi` 写 20 行探针，在真机上枚举并打开 `usagePage=0xFF60/usage=0x61` 的接口；失败则尝试 `IOHIDDeviceOpen(kIOHIDOptionsTypeSeizeDevice)` |
| R2 | macOS 沙箱/权限：HID 访问需不需要 entitlement | 中 | 无签名 ad-hoc 先验；正式分发需 Developer ID + 可能需 `com.apple.security.device.usb` |
| R3 | `hidapi` 无热插拔事件，设备拔出无法立即感知 | 中 | 用 `transfer` 失败兜底 + 1s 轮询 `hid_enumerate` |
| R4 | WKWebView 对部分 CSS/JS 特性支持差异 | 中 | 真机逐面板回归（尤其 MenuPanel、MacroPanel） |
| R5 | 文件拖拽导入（`DefinitionDropzone`）语义变化 | 中 | Tauri `onDragDropEvent` 适配 + 真机测试 |
| R6 | Windows WebView2 的 WebHID 需宿主处理权限事件 | 低（可继续走原生 HID 桥，保持一致） | Windows 真机测试 |
| R7 | Tauri 需要 Rust 工具链（macOS 需 Xcode CLT） | 低 | `rustup` + `cargo build` 冒烟 |

**最高优先级的验证 = R1**：先在真机上跑一个 `hidapi` 探针脚本，确认能打开目标键盘的 RAW HID 接口。
这一步通过，阶段 B 就只剩常规工程工作；不通过则需要重新评估（退回阶段 A + 接受 Electron 体积）。

---

## 8. 工作量与建议

| 阶段 | 内容 | 收益 | 投入 | 风险 |
| --- | --- | --- | --- | --- |
| **A** | Electron 产物裁剪 + 重签名 | 288M → ~223M（-23%） | 0.5 天 | 低 |
| **B0** | `hidapi` 真机探针（先验 R1） | 决定 B 是否可行 | 0.5 天 | — |
| **B** | Tauri v2 + 原生 HID 桥 | 288M → ~10M（-96%） | 1–2 周 | 中 |

**建议**：
1. **今天就能做**：阶段 A 落地，立刻把包体砍掉 1/4，无功能风险。
2. **本周先做 B0 探针**：用半天确认 macOS 能否用原生 HID 打开目标键盘——这是整条路径的唯一硬门槛。
3. **探针通过后**：以「保留 Electron 分支 + 新增 Tauri 分支」的方式并行开发，通过 feature flag 切换，
   真机验证全功能对齐后再删掉 Electron 分支。这样任何时刻都有可回退的可用版本。

---

## 附：相关文档

- `docs/ELECTRON.md` —— 当初选 Electron 的理由（本节结论与之衔接，但本评估给出了"裁剪 + 换壳 + 原生 HID 桥"的新解法）
- `docs/ARCHITECTURE.md` —— 传输层抽象（§4.2.3）的设计说明
- `src/core/hid/HidTransport.ts` —— 传输层接口（迁移的接入点）
- `src/core/hid/WebHidTransport.ts` —— 现有真实设备实现（新实现的参考模板）
- `scripts/make-app.mjs` —— 手工打包脚本（阶段 A 的裁剪接入点）

---

## 执行结果（2026-10-12）

| 阶段 | 结果 | 状态 |
|---|---|---|
| 阶段 A（Electron 裁剪） | 288.1M → **224.4M**（−22%）：裁非中英语言包 −47.7M、libvk_swiftshader + ICD manifest −15.8M（otool 实证无链接引用）、default_app.asar；libffmpeg.dylib 保留（链接期硬依赖） | ✅ 已落地 |
| 阶段 B（Tauri v2 + Rust hidapi） | Tauri .app **3.5M**（−98.8% vs 288M），dmg 2.5M；前端代码零改动，`NativeHidTransport` 激活 `'nodehid'` 预留位 | ✅ 已落地并投产 |

DoD 五关全过（R1 真机探针 / 帧级等价 diff / feature-report 往返 / build+启动 / 真机写读往返）。本文其余章节保留为决策过程记录。
