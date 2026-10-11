// 前端诊断打点：经 debug_note command 写入 /tmp/keydriver-hid.log（Rust 侧 env 门控）。
// 仅在 Tauri 运行时可用；失败静默（诊断通道绝不能影响业务）。
export async function note(text: string): Promise<void> {
  try {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('debug_note', { text });
  } catch {
    // 诊断通道失败不影响业务
  }
}
