# KeyDriver Lite

轻量化分发的键盘配置工具（Electron + Vite + React 19，VIA V3 / WebHID）。

> KeyDriver Lite 是 [keydriver](https://github.com/baoru0908/keydriver) 的**轻量化打包分支**：
> **功能集、UI、代码与主版完全一致**，唯一差异是打包产物做了运行时裁剪（阶段 A），
> 使 macOS .app 体积从 ~288M 降到 ~223M（约 -23%）。

## 与主版的差异

| 项 | 主版 KeyDriver | Lite |
| --- | --- | --- |
| 功能 / UI / 协议 | — | **完全一致** |
| `package.json` 身份 | `keydriver` / `KeyDriver` / `com.keydriver.app` | `keydriver-lite` / `KeyDriver Lite` / `com.keydriver.lite` |
| 打包裁剪 | 无 | `scripts/make-app.mjs` 第 3.5 步（阶段 A） |
| macOS .app 体积 | ~288M | **~223M** |

### 裁剪明细（对应 `docs/SIZE-REDUCTION-EVAL.md` §5 阶段 A）

| 裁剪项 | 约省 | 说明 |
| --- | --- | --- |
| 非中英语言包（`*.lproj`，仅保留 `en.lproj` / `zh_CN.lproj`） | ~47M | UI 只有中英文，其余 200+ 语言包属 Electron 全量分发 |
| `libvk_swiftshader.dylib` | ~16M | 软件渲染回退；纯 2D DOM 界面无 WebGL 需求 |
| `libffmpeg.dylib` | ~2.2M | Chromium 媒体解码库；应用无音视频播放 |
| `default_app.asar` | ~112K | Electron 自带示例应用，已被本应用取代 |

**不动**：`icudtl.dat` / `resources.pak` / `chrome_200_percent.pak`（Chromium 运行必需）。

### 顺序约束

裁剪在 `make-app.mjs` 中固定于「注入资源之后、codesign 之前」：
签名后再删文件会破坏 CodeSignature，应用会启动即退出。

## 开发

```bash
npm install
npm run check          # guard + tsc
npm test               # 串行 vitest
npm run app            # 构建 + 打包裁剪出 release/KeyDriver Lite.app
```

首次启动需导入一份键盘定义文件（打包时已附在 `release/definitions/`）。
