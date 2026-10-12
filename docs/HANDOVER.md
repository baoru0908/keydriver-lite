# KeyDriver 交接文档

> 交接日期：2026-10-11 · 交接人：交付总监（主理人）· 团队：software-keydriver-audit（PM 许清楚 / 架构师 高见远 / 工程师 寇豆码 / QA 严过关）
> 本文档**取代** 2026-10-10 旧版交接（旧版基线：492 用例 12 红、真机未接入——均已过时）

> ⚡ **现状更新（2026-10-12）**：阶段 B（Tauri v2 + Rust hidapi 桥）**已完成并投产**，Tauri .app 3.5M（−98.8%，前端代码零改动）；双仓 src 同源同步，串行测试全绿。详见 §3 阶段 B 里程碑。

## 1. 项目全景

| 仓库 | 本地路径 | GitHub | 外壳 |
|------|---------|--------|------|
| KeyDriver 原版 | `/Users/baoru/Downloads/AI/keydriver` | `baoru0908/keydriver`（私有） | Electron（主版，WebHID） |
| KeyDriver Lite | `/Users/baoru/Downloads/AI/keydriver-lite` | `baoru0908/keydriver-lite`（私有） | **Tauri v2 + Rust hidapi 桥（发布形态）** |

- 技术栈：Vite + React 19 + TypeScript + Tailwind v4（CSS-first @theme）+ Radix + zustand + lucide；主版外壳 Electron，Lite 外壳 Tauri（`NativeHidTransport` 实现 `'nodehid'` 预留位）
- 协议：VIA V3（usagePage 0xFF60 / usage 0x61），目标键盘 Em60 / EC_BM60（VID 0x5594 / PID 0x0005）；主版走 WebHID，Lite 走 Rust hidapi
- 两仓 src/ 同源同步（评估实证逐文件一致）；Git 历史各自独立，修复以双仓同改方式落盘
- 测试基线：串行 vitest 全绿（两仓一致，当前 670+ 用例）

## 2. 已交付（全部已推送 GitHub）

### 迭代 1（P0）
- T01 分发合规：after-sign 公证钩子（env 门控，无证书回退 ad-hoc）、electronLanguages、hardenedRuntime
- T02 感知性能：函数式 manualChunks（react-vendor/radix-ui/zod/react-colorful）、重面板 React.lazy
- T03-1..5：设计令牌基座、useViewTransition、主题基建（深色默认 / theme-dark·theme-light / 首启跟随系统）、间距防回潮守卫（codemod-spacing.mjs）、Button/Switch/Modal 微动效

### 迭代 2（T06-1..10）
- **P0**：设备断连感知（`'lost'` 态 + intentionalClose 守卫 + 保留脏值 + 一键重连）；未保存关窗拦截（`electron/preload.cjs` 唯一 IPC 面，`keydriver:` 通道前缀 + 原生 dialog）；最小窗口 960×640 + 启动白闪消除 + 窄窗键码面板自动折叠
- **UI P1**：EmptyState/Skeleton/ErrorState 三态原语（design-tokens.md §7 规格）、Radix Tabs、Card/Badge、e2–e4 elevation、亮色语义色补齐、reduced-motion 全局降级
- **多平台**：useBreakpoint 单一断点源（1080px）+ SideNav compact、快捷键同源体系（⌘/Ctrl S/Z/1-7//，platform.ts 注册与标签同数据）、caption 12px 收敛、主题切换同步窗口底色

### BugFix（滑块三部曲）
| Commit | 问题 | 根因 | 修复 |
|--------|------|------|------|
| `f631fff` | Backlight 亮度/速度值被清零 | 写后回读自校验见回读不一致就自动 alt 宽度重写；固件对 channel 3 回读恒 0 → 2 字节重写被固件按 1 字节解析取 0x00 | 回读不一致**绝不重写设备**，改只读探测+告警 |
| `2e72085` | 所有滑块失效 | ①无单实例锁，双开抢 WebHID 设备；②固件坏回读覆盖乐观值；③探测失败误报"写入失败" | requestSingleInstanceLock + verified 地址保留乐观值 + 探测失败改发"回读校验失败"告警 |

### Lite 阶段 A
- 品牌改名（KeyDriver Lite / com.keydriver.lite）+ 打包裁剪：**288.1M → 224.4M（-22%）**
- 裁剪清单（otool 实证）：非中英语言包（-47.7M）、libvk_swiftshader.dylib + vk_swiftshader_icd.json（-15.8M，无 Mach-O 链接引用）、default_app.asar；**libffmpeg.dylib 不删**（链接期硬依赖）
- 冒烟验证通过（存活、零崩溃报告、codesign --verify --deep 绿）

## 3. 未完成 / Backlog

### 阶段 B（✅ 已完成，2026-10-12 投产）
- **Tauri v2 + Rust hidapi 桥落地**：`NativeHidTransport` 实现既有 `HidTransport` 接口的 `'nodehid'` 预留位，`src/core/hid/index.ts` 工厂激活
- **体积结果**：Tauri .app **3.5M**（−98.8% vs Electron 288M），dmg 2.5M（自定义 dmgbuild 安装界面）；前端代码零改动
- DoD 五关全过：R1 真机探针绿、NativeHidTransport+hid.rs 帧级等价 diff、feature-report 往返、Tauri build+启动 secure context 正常、真机配置写读往返
- 真机 bug 修复（阶段 B 后）：固件回读撒谎 → ConfigCache 本地缓存优先 + distrust 持久化；关窗 onCloseRequested 落盘 + 重连 reconcileFromCache 对账下发
- 键码字典：实证目标固件协议 v12 但用 QMK v9 新编码（0x5221=MO(1)），KeycodeFormatter 已加 v9 兜底
- 平台覆盖：macOS arm64（x64 macOS / Windows / 签名公证见 Backlog）

### Backlog
1. mid-connect 意外断连终态 'error' 而非 'lost'（低严重度）
2. 快捷键「输入框聚焦不抢键」无自动化测试（需引入 jsdom，环境决策）
3. P2 字号批次：~55 处散落 `text-[10px]/[11px]/[12px]` 收敛（连带键码网格密度/按钮高度，独立批次）
4. Linux 分发 target（AppImage/deb + udev 说明）
5. ~~verifyWrite 死代码删除~~（✅ 2026-10-12 已删，含 alt 宽度重写隐患，防误用复活）
6. ~~eslint 悬空~~（✅ 2026-10-12 已删悬空 `lint` 脚本；后续如需 lint 再装 eslint + flat config）
7. ~~Lite 残留 Electron 死配置~~（✅ 2026-10-12 已清：package.json 的 main/electron:dev/electron:build/build 块/optionalDependencies + `electron/` 目录 + `scripts/after-sign.mjs`，git 历史可恢复）
8. Lite 平台覆盖：x64 macOS、Windows（hidapi 桥通用，主要回归 WebView2 行为）；Developer ID 签名 + 公证
9. 协议键码 Bug C（战略层，待议）：QMK v9 中 MOD_TAP 由 0x6000 迁至 0x2000，需真机实证后补齐 media/lighting/quantum/macro 键码组
10. 抽 `DeviceProtocol` 接口使 VIA 成为协议实现之一（「静电容优先」战略前置）


## 4. 用户待办

1. **真机复测**：Tauri Lite（3.5M）为主力版本——改键/滑块/主题/键位测试全链路；发现回读异常时点「从设备重新读取」按钮
2. ~~阶段 B 开工时配合 R1 探针~~（✅ 已完成，探针 PASS）

## 5. 关键教训（踩坑实录）

1. **裁剪 Electron 组件必须 `otool -L` 实证**：`libffmpeg.dylib` 是 Electron Framework 链接期硬依赖（LC_LOAD_DYLIB），凭"无媒体需求"推断删除 → dyld SIGABRT 启动即崩。删除任何 Framework 内组件前先全 bundle 扫描链接引用
2. `libvk_swiftshader.dylib` 无 Mach-O 链接引用（动态加载的 Vulkan ICD）可安全删除，`vk_swiftshader_icd.json` 随删避免悬空 manifest
3. **固件回读会撒谎**：channel 3 亮度/速度 GET 恒回 0。任何"回读不一致即自动重写"的逻辑都会把值清零（2 字节大端编码值≤255 时首字节恒 0）。自校验的自动纠错若纠错动作本身有副作用，比不纠错更危险
4. **Electron 必须加 `requestSingleInstanceLock`**：双开抢 WebHID 设备，第二实例写入全部静默失败
5. **本机 git push 通道**：全局 insteadOf 把 SSH 重写为 HTTPS 且走代理，代理对 github.com 会间歇 502。SSH 直连绕过：`git -c url."git@github.com:baoru0908/".insteadOf="git@github.com:baoru0908/" push git@github.com:baoru0908/<repo>.git main`（恒等映射抢最长匹配优先权，绕过全局重写）
6. **测试必须串行**：`npx vitest run --maxWorkers=1 --minWorkers=1`，并行时 SSR 冷启动用例假超时
7. macOS BSD grep 不支持 `\|`，用 ripgrep（Grep 工具），否则静默无输出误导判断
8. npm 安装依赖可能清掉 `node_modules/electron/dist` 二进制且离线无法重下——可从已构建 .app 的 `Contents/Frameworks/` 抢救还原

## 6. 工程约定

- `npm run check` = tsc + 硬编码守卫（只扫 src）+ codemod-spacing + definition-stats
- 代码风格：2 空格缩进、src 下分号结尾、零硬编码（新视觉属性先加令牌再加类）
- 提交规范：**严禁 author trailer**；团队成员不 commit，主理人统一提交推送
- 设计基准：`docs/design-tokens.md`（§3 elevation / §4 motion / §7 状态范式 / §8 状态色）；需求基准：`docs/PRD-iteration2.md`；架构与瘦身评估：`docs/ARCHITECTURE.md` · `docs/SIZE-REDUCTION-EVAL.md`
- 打包：`scripts/make-app.mjs` 是离线兜底（裁剪+ad-hoc 签名都在这）；electron-builder 配置并存（正式签名渠道）
- Lite 与原版同步：原版修 bug → lite `git fetch upstream main && git cherry-pick <hash>` → 串行测试确认 → push

## 7. 团队协作流程备注

- 流程调整（用户反馈 QA 环节效率偏低后生效）：**轻量验证由主理人亲自执行（分钟级：otool/产物结构/冒烟/串行测试抽查），QA 保留给高风险环节**——阶段 B 的 hidapi 桥帧级等价性验证是下一个 QA 主战场
- 交接时团队状态：全部成员已暂停待命，可随时按上述 Backlog 重新拉起
