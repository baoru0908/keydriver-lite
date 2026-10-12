// 关窗 / 失焦落盘：补上「改动还没落盘就关窗」的缺口。
//
// 背景（真机帧日志实证）：VIA 的 SET 只改 RAM，0x09 才写 EEPROM。
// 既有策略是「空闲 1.5s 防抖落盘 + disconnect 时 flush」，但：
//   · 用户改完 1.5s 内关窗 → 防抖定时器没来得及触发；
//   · 关窗路径从未调用 disconnect/flush（无 beforeunload、无 close 监听）；
//   · 实测 5 次开软件、十几次写入，0 次 0x09——改动全留在 RAM，键盘一断电全部回退。
//
// 本模块把三个口子都堵上：
//   1) Tauri：onCloseRequested 拦截 → flush（2s 上限）→ 放行关闭；
//   2) 浏览器 / Electron：beforeunload 尽力 flush（异步不保证完成，仅兜底）；
//   3) 窗口失焦：用户切走常常意味着即将关闭，顺手 flush（无待办时是空操作）。
import { getFacade } from '@/store/useDeviceStore';

/** flush 等待上限：绝不卡住关窗（EEPROM 写不动时放弃，好过关不掉）。 */
const FLUSH_TIMEOUT_MS = 2000;

let bound = false;

async function flushPendingSaves(): Promise<void> {
  const facade = getFacade();
  if (!facade) return;
  await facade.flushAutoSaves().catch(() => undefined);
}

/** Tauri v2：关窗请求时先落盘再放行（无待办不拦截，正常关窗零延迟）。 */
async function bindTauriClose(): Promise<void> {
  try {
    // 变量路径 + @vite-ignore：让非 Tauri 构建（Electron 版）不在构建期解析此依赖，
    // 运行时模块不存在自然走 catch 分支（beforeunload 兜底）。
    const specifier = '@tauri-apps/api/window';
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      getCurrentWindow: () => {
        onCloseRequested: (cb: (event: { preventDefault: () => void }) => Promise<void>) => Promise<void>;
        close: () => Promise<void>;
      };
    };
    const win = mod.getCurrentWindow();
    await win.onCloseRequested(async (event) => {
      const facade = getFacade();
      if (!facade || !facade.hasPendingSaves) return;
      event.preventDefault();
      await Promise.race([
        flushPendingSaves(),
        new Promise<void>((resolve) => {
          setTimeout(resolve, FLUSH_TIMEOUT_MS);
        }),
      ]);
      await win.close();
    });
  } catch {
    // 非 Tauri 环境（浏览器 / Electron / 测试）：beforeunload 兜底
  }
}

/** 绑定关窗 / 失焦落盘（幂等）。AppShell 挂载时调用一次。 */
export function bindCloseFlush(): void {
  if (bound || typeof window === 'undefined') return;
  bound = true;
  window.addEventListener('beforeunload', () => {
    void flushPendingSaves();
  });
  window.addEventListener('blur', () => {
    void flushPendingSaves();
  });
  void bindTauriClose();
}
