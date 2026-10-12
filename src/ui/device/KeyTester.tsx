// Key Tester：真实键位测试器（第二阶段设备侧项）。
//
// 事件来源说明（重要，勿改）：
// 真实按键事件来自标准 HID 键盘接口（usage page 0x01），它独立于 VIA 配置协议，
// 本阶段传输层只实现 VIA，因此本组件先用 window 的 keydown/keyup 捕捉本机键盘做演示，
// 以便立刻验证高亮交互。
//
// 匹配策略：不按“键帽标签字符串”做模糊匹配（方向键 ←/↑/↓/→ 等会被 normalize 成空串），
// 而是按 QMK 基础键码 → KeyboardEvent.code 的物理位置映射。只有基础 HID 键码能对应
// 真实物理键；层操作 / Mod-Tap / Custom 等无固定物理键，不参与高亮。
//
// TODO(Alex): 接真机时应改走设备的 HID 键盘报告——由传输层把键盘报文解析为
// (code, down/up) 事件后喂给 useKeyTester（当前 useKeyTester 只认 KeyboardEvent.code）。
// 该真实 HID 键盘监听是独立路径，不在本阶段实装（避免引入第二条 HID 接口监听）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDefinitionStore } from '@/store/useDefinitionStore';
import { useKeymapStore, selectKeycode } from '@/store/useKeymapStore';
import { boundingBox, fitScale } from '@/definition/KleGeometry';
import { format, formatKeycap } from '@/keycodes/KeycodeFormatter';
import { keycodeToEventCode } from '@/keycodes/HidCodeMap';
import { cn } from '@/shared/cn';

/**
 * KeyboardEvent.code → 通用可读短标签。
 * 这里只映射通用 HID 键名（字母/数字/修饰键/功能键等），不写死任何具体键盘的特征词。
 */
const CODE_LABELS: Readonly<Record<string, string>> = {
  // 字母
  KeyA: 'A', KeyB: 'B', KeyC: 'C', KeyD: 'D', KeyE: 'E', KeyF: 'F', KeyG: 'G',
  KeyH: 'H', KeyI: 'I', KeyJ: 'J', KeyK: 'K', KeyL: 'L', KeyM: 'M', KeyN: 'N',
  KeyO: 'O', KeyP: 'P', KeyQ: 'Q', KeyR: 'R', KeyS: 'S', KeyT: 'T', KeyU: 'U',
  KeyV: 'V', KeyW: 'W', KeyX: 'X', KeyY: 'Y', KeyZ: 'Z',
  // 数字
  Digit0: '0', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4',
  Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9',
  // 常用控制键
  Space: 'Space', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab',
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift',
  ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt', AltRight: 'R-Alt',
  MetaLeft: 'L-Meta', MetaRight: 'R-Meta',
  CapsLock: 'Caps', ContextMenu: 'Menu',
  // 符号键
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  // 方向键
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  // 编辑键
  Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End',
  PageUp: 'PgUp', PageDown: 'PgDn', PrintScreen: 'PrtSc', ScrollLock: 'Scroll', Pause: 'Pause',
  // 功能键
  F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
  F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
  // 小键盘
  NumLock: 'NumLk', NumpadDivide: 'Num /', NumpadMultiply: 'Num *', NumpadSubtract: 'Num -',
  NumpadAdd: 'Num +', NumpadEnter: 'Num ↵', NumpadDecimal: 'Num .', NumpadEqual: 'Num =',
  Numpad0: 'Num 0', Numpad1: 'Num 1', Numpad2: 'Num 2', Numpad3: 'Num 3', Numpad4: 'Num 4',
  Numpad5: 'Num 5', Numpad6: 'Num 6', Numpad7: 'Num 7', Numpad8: 'Num 8', Numpad9: 'Num 9',
};

/** 取可读标签；无映射时退回原始 code，保证总能显示。 */
function readableLabel(code: string): string {
  return CODE_LABELS[code] ?? code;
}

export interface KeyTesterState {
  /** 当前按下的键（按 KeyboardEvent.code 去重，稳定顺序数组，便于渲染）。 */
  readonly pressedList: readonly string[];
}

/**
 * 监听 window 的 keydown/keyup，维护当前按下的键集合。
 * 用 useRef 保存集合、useState 触发重渲染，确保卸载时清理监听。
 */
export function useKeyTester(): KeyTesterState {
  const pressedRef = useRef<Set<string>>(new Set());
  const [pressedList, setPressedList] = useState<readonly string[]>([]);

  useEffect(() => {
    const onDown = (event: KeyboardEvent): void => {
      if (pressedRef.current.has(event.code)) return; // 忽略系统自动重复
      pressedRef.current.add(event.code);
      setPressedList(Array.from(pressedRef.current));
    };
    const onUp = (event: KeyboardEvent): void => {
      if (!pressedRef.current.has(event.code)) return;
      pressedRef.current.delete(event.code);
      setPressedList(Array.from(pressedRef.current));
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  return { pressedList };
}

export function KeyTester(): React.JSX.Element {
  const { pressedList } = useKeyTester();
  const definition = useDefinitionStore((s) => s.definition);
  const currentLayer = useKeymapStore((s) => s.currentLayer);
  const keymapState = useKeymapStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = (): void => setContainerWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 基于 definition.keys（KLE 归一化后的逻辑坐标，单位 u）定位键帽。
  const keys = useMemo(() => (definition ? definition.keys : []), [definition]);
  const box = useMemo(() => boundingBox(keys), [keys]);
  const scale = containerWidth > 0 ? fitScale(box.width, containerWidth) : 1;

  // 当前按下的 KeyboardEvent.code 集合。
  const pressedCodes = useMemo(() => new Set(pressedList), [pressedList]);

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-fg">Key Tester（键位测试）</h2>

      {/* 当前按下 chips */}
      <div className="mb-3 flex min-h-[28px] flex-wrap items-center gap-1.5">
        {pressedList.length === 0 ? (
          <span className="text-xs text-fg-muted">按下任意键开始测试</span>
        ) : (
          pressedList.map((code) => (
            <span
              key={code}
              className="rounded bg-accent-soft px-2 py-0.5 font-mono text-xs text-accent"
            >
              {readableLabel(code)}
            </span>
          ))
        )}
      </div>

      {/* 键位高亮网格：按下对应键时，位置匹配的键帽高亮 */}
      {/* ⚠️ padding 放在外层：被测量的元素自身不能有 padding，否则 clientWidth 含 padding、缩放后恒定溢出 */}
      <div className="rounded border border-border bg-elevated p-3">
        <div ref={containerRef} className="min-w-0 overflow-x-auto">
          {keys.length > 0 ? (
            <div
              className="relative"
              style={{ width: box.width * scale, height: box.height * scale }}
            >
              {keys.map((key) => {
                const keycode = selectKeycode(
                  keymapState,
                  currentLayer,
                  key.matrix.row,
                  key.matrix.col,
                );
                const expectedCode = keycodeToEventCode(keycode);
                const active = expectedCode !== undefined && pressedCodes.has(expectedCode);
                const label = formatKeycap(keycode)[0] ?? '';
                return (
                  <div
                    key={`${key.matrix.row},${key.matrix.col}`}
                    className={cn(
                      'absolute flex items-center justify-center overflow-hidden rounded border text-[9px] leading-none transition-colors',
                      active
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-border bg-surface text-fg-muted',
                    )}
                    style={{
                      // 减掉包围盒原点，键位才贴齐画布左上角（KLE 原点不一定是可见键帽的左上角）
                      left: (key.rect.x - box.minX) * scale,
                      top: (key.rect.y - box.minY) * scale,
                      width: key.rect.w * scale,
                      height: key.rect.h * scale,
                    }}
                    title={`${format(keycode)} · 矩阵 (${key.matrix.row},${key.matrix.col})`}
                  >
                    <span className="px-0.5 text-center">{label}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-fg-muted">
              尚未加载键位布局，导入定义并连接后可看到键位高亮。
            </p>
          )}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-fg-muted">
        本机键盘演示（Dummy/桌面模式）。接真机会走设备 HID 键盘报告——该路径留待后续实现（见组件内 TODO 注释）。
      </p>
    </section>
  );
}
