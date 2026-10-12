// QMK 基础键码（≈ HID Keyboard usage）→ KeyboardEvent.code 的物理键映射。
// 用于 KeyTester：按下本机键盘时，根据键码直接高亮布局上对应的键位。
// 只包含基础 HID 键码（0x00–0xFF）；层操作 / Mod-Tap / Custom 等无固定物理键，不参与映射。

export const KEYCODE_TO_EVENT_CODE = new Map<number, string>([
  // 字母 A–Z（0x04–0x1D）
  [0x0004, 'KeyA'],
  [0x0005, 'KeyB'],
  [0x0006, 'KeyC'],
  [0x0007, 'KeyD'],
  [0x0008, 'KeyE'],
  [0x0009, 'KeyF'],
  [0x000a, 'KeyG'],
  [0x000b, 'KeyH'],
  [0x000c, 'KeyI'],
  [0x000d, 'KeyJ'],
  [0x000e, 'KeyK'],
  [0x000f, 'KeyL'],
  [0x0010, 'KeyM'],
  [0x0011, 'KeyN'],
  [0x0012, 'KeyO'],
  [0x0013, 'KeyP'],
  [0x0014, 'KeyQ'],
  [0x0015, 'KeyR'],
  [0x0016, 'KeyS'],
  [0x0017, 'KeyT'],
  [0x0018, 'KeyU'],
  [0x0019, 'KeyV'],
  [0x001a, 'KeyW'],
  [0x001b, 'KeyX'],
  [0x001c, 'KeyY'],
  [0x001d, 'KeyZ'],

  // 数字 1–0（0x1E–0x27）
  [0x001e, 'Digit1'],
  [0x001f, 'Digit2'],
  [0x0020, 'Digit3'],
  [0x0021, 'Digit4'],
  [0x0022, 'Digit5'],
  [0x0023, 'Digit6'],
  [0x0024, 'Digit7'],
  [0x0025, 'Digit8'],
  [0x0026, 'Digit9'],
  [0x0027, 'Digit0'],

  // 编辑与功能键
  [0x0028, 'Enter'],
  [0x0029, 'Escape'],
  [0x002a, 'Backspace'],
  [0x002b, 'Tab'],
  [0x002c, 'Space'],

  // 符号键
  [0x002d, 'Minus'],
  [0x002e, 'Equal'],
  [0x002f, 'BracketLeft'],
  [0x0030, 'BracketRight'],
  [0x0031, 'Backslash'],
  [0x0032, 'NonUSBackslash'], // 少数布局的 IntlBackslash
  [0x0033, 'Semicolon'],
  [0x0034, 'Quote'],
  [0x0035, 'Backquote'],
  [0x0036, 'Comma'],
  [0x0037, 'Period'],
  [0x0038, 'Slash'],

  // 大写锁定
  [0x0039, 'CapsLock'],

  // F1–F12
  [0x003a, 'F1'],
  [0x003b, 'F2'],
  [0x003c, 'F3'],
  [0x003d, 'F4'],
  [0x003e, 'F5'],
  [0x003f, 'F6'],
  [0x0040, 'F7'],
  [0x0041, 'F8'],
  [0x0042, 'F9'],
  [0x0043, 'F10'],
  [0x0044, 'F11'],
  [0x0045, 'F12'],

  // 编辑键与方向键
  [0x0046, 'PrintScreen'],
  [0x0047, 'ScrollLock'],
  [0x0048, 'Pause'],
  [0x0049, 'Insert'],
  [0x004a, 'Home'],
  [0x004b, 'PageUp'],
  [0x004c, 'Delete'],
  [0x004d, 'End'],
  [0x004e, 'PageDown'],
  [0x004f, 'ArrowRight'],
  [0x0050, 'ArrowLeft'],
  [0x0051, 'ArrowDown'],
  [0x0052, 'ArrowUp'],

  // 小键盘
  [0x0053, 'NumLock'],
  [0x0054, 'NumpadDivide'],
  [0x0055, 'NumpadMultiply'],
  [0x0056, 'NumpadSubtract'],
  [0x0057, 'NumpadAdd'],
  [0x0058, 'NumpadEnter'],
  [0x0059, 'Numpad1'],
  [0x005a, 'Numpad2'],
  [0x005b, 'Numpad3'],
  [0x005c, 'Numpad4'],
  [0x005d, 'Numpad5'],
  [0x005e, 'Numpad6'],
  [0x005f, 'Numpad7'],
  [0x0060, 'Numpad8'],
  [0x0061, 'Numpad9'],
  [0x0062, 'Numpad0'],
  [0x0063, 'NumpadDecimal'],
  [0x0067, 'NumpadEqual'],

  // 修饰键（左右区分）
  [0x00e0, 'ControlLeft'],
  [0x00e1, 'ShiftLeft'],
  [0x00e2, 'AltLeft'],
  [0x00e3, 'MetaLeft'],
  [0x00e4, 'ControlRight'],
  [0x00e5, 'ShiftRight'],
  [0x00e6, 'AltRight'],
  [0x00e7, 'MetaRight'],
]);

/** 反向查找：KeyboardEvent.code → 基础键码。 */
export const EVENT_CODE_TO_KEYCODE = new Map<string, number>();
for (const [kc, code] of KEYCODE_TO_EVENT_CODE) {
  EVENT_CODE_TO_KEYCODE.set(code, kc);
}

/** 取某个基础键码对应的 KeyboardEvent.code；无映射返回 undefined。 */
export function keycodeToEventCode(keycode: number): string | undefined {
  return KEYCODE_TO_EVENT_CODE.get(keycode & 0xff);
}
