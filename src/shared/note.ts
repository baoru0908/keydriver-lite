// 前端诊断打点：经 debug_note command 写入 /tmp/keydriver-hid.log（Rust 侧 env 门控）。
// 仅在 Tauri 运行时可用；失败静默（诊断通道绝不能影响业务）。
// ⚠️ 动态 import 走变量路径 + @vite-ignore：让未安装 @tauri-apps/api 的构建
// （Electron 完整版）不在构建期解析该依赖，运行时天然走不到（无 __TAURI_INTERNALS__）。
export async function note(text: string): Promise<void> {
  try {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    const specifier = '@tauri-apps/api/core';
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
    await mod.invoke('debug_note', { text });
  } catch {
    // 诊断通道失败不影响业务
  }
}
