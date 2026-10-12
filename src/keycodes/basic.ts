// Basic 键码表（S1 必做，架构 §8.10）：字母、数字、符号、修饰、系统、编辑键、方向键、小键盘。
import type { KeycodeDef } from './types';

export const KC_NO = 0x0000;
export const KC_TRNS = 0x0001;

interface Row {
  readonly code: number;
  readonly name: string;
  readonly label?: string;
  readonly short?: string;
  readonly aliases?: readonly string[];
}

/** code → 名称；名称带 KC_ 前缀，label 为界面显示名。 */
const ROWS: readonly Row[] = [
  { code: 0x0000, name: 'KC_NO', label: '禁用', short: '✕' },
  { code: 0x0001, name: 'KC_TRNS', label: '透明', short: '▽' },

  // 编辑与功能键
  { code: 0x0028, name: 'KC_ENT', label: 'Enter', short: 'Enter' },
  { code: 0x0029, name: 'KC_ESC', label: 'Esc' },
  { code: 0x002a, name: 'KC_BSPC', label: 'Backspace', short: 'Bksp' },
  { code: 0x002b, name: 'KC_TAB', label: 'Tab' },
  { code: 0x002c, name: 'KC_SPC', label: 'Space', short: '␣' },
  { code: 0x002d, name: 'KC_MINS', label: '-', short: '-' },
  { code: 0x002e, name: 'KC_EQL', label: '=', short: '=' },
  { code: 0x002f, name: 'KC_LBRC', label: '[', short: '[' },
  { code: 0x0030, name: 'KC_RBRC', label: ']', short: ']' },
  { code: 0x0031, name: 'KC_BSLS', label: '\\', short: '\\' },
  { code: 0x0033, name: 'KC_SCLN', label: ';', short: ';' },
  { code: 0x0034, name: 'KC_QUOT', label: "'", short: "'" },
  { code: 0x0035, name: 'KC_GRV', label: '`', short: '`' },
  { code: 0x0036, name: 'KC_COMM', label: ',', short: ',' },
  { code: 0x0037, name: 'KC_DOT', label: '.', short: '.' },
  { code: 0x0038, name: 'KC_SLSH', label: '/', short: '/' },
  { code: 0x0039, name: 'KC_CAPS', label: 'Caps Lock', short: 'Caps' },

  // 字母 A–Z（HID usage 0x04–0x1D）
  { code: 0x0004, name: 'KC_A', label: 'A' },
  { code: 0x0005, name: 'KC_B', label: 'B' },
  { code: 0x0006, name: 'KC_C', label: 'C' },
  { code: 0x0007, name: 'KC_D', label: 'D' },
  { code: 0x0008, name: 'KC_E', label: 'E' },
  { code: 0x0009, name: 'KC_F', label: 'F' },
  { code: 0x000a, name: 'KC_G', label: 'G' },
  { code: 0x000b, name: 'KC_H', label: 'H' },
  { code: 0x000c, name: 'KC_I', label: 'I' },
  { code: 0x000d, name: 'KC_J', label: 'J' },
  { code: 0x000e, name: 'KC_K', label: 'K' },
  { code: 0x000f, name: 'KC_L', label: 'L' },
  { code: 0x0010, name: 'KC_M', label: 'M' },
  { code: 0x0011, name: 'KC_N', label: 'N' },
  { code: 0x0012, name: 'KC_O', label: 'O' },
  { code: 0x0013, name: 'KC_P', label: 'P' },
  { code: 0x0014, name: 'KC_Q', label: 'Q' },
  { code: 0x0015, name: 'KC_R', label: 'R' },
  { code: 0x0016, name: 'KC_S', label: 'S' },
  { code: 0x0017, name: 'KC_T', label: 'T' },
  { code: 0x0018, name: 'KC_U', label: 'U' },
  { code: 0x0019, name: 'KC_V', label: 'V' },
  { code: 0x001a, name: 'KC_W', label: 'W' },
  { code: 0x001b, name: 'KC_X', label: 'X' },
  { code: 0x001c, name: 'KC_Y', label: 'Y' },
  { code: 0x001d, name: 'KC_Z', label: 'Z' },

  // 数字 1–0（HID usage 0x1E–0x27）
  { code: 0x001e, name: 'KC_1', label: '1' },
  { code: 0x001f, name: 'KC_2', label: '2' },
  { code: 0x0020, name: 'KC_3', label: '3' },
  { code: 0x0021, name: 'KC_4', label: '4' },
  { code: 0x0022, name: 'KC_5', label: '5' },
  { code: 0x0023, name: 'KC_6', label: '6' },
  { code: 0x0024, name: 'KC_7', label: '7' },
  { code: 0x0025, name: 'KC_8', label: '8' },
  { code: 0x0026, name: 'KC_9', label: '9' },
  { code: 0x0027, name: 'KC_0', label: '0' },

  // 功能键 F1–F12
  { code: 0x003a, name: 'KC_F1', label: 'F1' },
  { code: 0x003b, name: 'KC_F2', label: 'F2' },
  { code: 0x003c, name: 'KC_F3', label: 'F3' },
  { code: 0x003d, name: 'KC_F4', label: 'F4' },
  { code: 0x003e, name: 'KC_F5', label: 'F5' },
  { code: 0x003f, name: 'KC_F6', label: 'F6' },
  { code: 0x0040, name: 'KC_F7', label: 'F7' },
  { code: 0x0041, name: 'KC_F8', label: 'F8' },
  { code: 0x0042, name: 'KC_F9', label: 'F9' },
  { code: 0x0043, name: 'KC_F10', label: 'F10' },
  { code: 0x0044, name: 'KC_F11', label: 'F11' },
  { code: 0x0045, name: 'KC_F12', label: 'F12' },

  // 编辑键与方向键
  { code: 0x0046, name: 'KC_PSCR', label: 'Print Screen', short: 'PrtSc' },
  { code: 0x0047, name: 'KC_SLCK', label: 'Scroll Lock', short: 'ScrLk' },
  { code: 0x0048, name: 'KC_PAUS', label: 'Pause', short: 'Pause' },
  { code: 0x0049, name: 'KC_INS', label: 'Insert', short: 'Ins' },
  { code: 0x004a, name: 'KC_HOME', label: 'Home' },
  { code: 0x004b, name: 'KC_PGUP', label: 'Page Up', short: 'PgUp' },
  { code: 0x004c, name: 'KC_DEL', label: 'Delete', short: 'Del' },
  { code: 0x004d, name: 'KC_END', label: 'End' },
  { code: 0x004e, name: 'KC_PGDN', label: 'Page Down', short: 'PgDn' },
  { code: 0x004f, name: 'KC_RGHT', label: '→', short: '→' },
  { code: 0x0050, name: 'KC_LEFT', label: '←', short: '←' },
  { code: 0x0051, name: 'KC_DOWN', label: '↓', short: '↓' },
  { code: 0x0052, name: 'KC_UP', label: '↑', short: '↑' },

  // 小键盘
  { code: 0x0053, name: 'KC_NUMLOCK', label: 'Num Lock', short: 'NumLk' },
  { code: 0x0054, name: 'KC_KP_SLASH', label: 'Keypad /', short: 'Num /' },
  { code: 0x0055, name: 'KC_KP_ASTERISK', label: 'Keypad *', short: 'Num *' },
  { code: 0x0056, name: 'KC_KP_MINUS', label: 'Keypad -', short: 'Num -' },
  { code: 0x0057, name: 'KC_KP_PLUS', label: 'Keypad +', short: 'Num +' },
  { code: 0x0058, name: 'KC_KP_ENTER', label: 'Keypad Enter', short: 'Num ↵' },
  { code: 0x0059, name: 'KC_KP_1', label: 'Keypad 1', short: 'Num 1' },
  { code: 0x005a, name: 'KC_KP_2', label: 'Keypad 2', short: 'Num 2' },
  { code: 0x005b, name: 'KC_KP_3', label: 'Keypad 3', short: 'Num 3' },
  { code: 0x005c, name: 'KC_KP_4', label: 'Keypad 4', short: 'Num 4' },
  { code: 0x005d, name: 'KC_KP_5', label: 'Keypad 5', short: 'Num 5' },
  { code: 0x005e, name: 'KC_KP_6', label: 'Keypad 6', short: 'Num 6' },
  { code: 0x005f, name: 'KC_KP_7', label: 'Keypad 7', short: 'Num 7' },
  { code: 0x0060, name: 'KC_KP_8', label: 'Keypad 8', short: 'Num 8' },
  { code: 0x0061, name: 'KC_KP_9', label: 'Keypad 9', short: 'Num 9' },
  { code: 0x0062, name: 'KC_KP_0', label: 'Keypad 0', short: 'Num 0' },
  { code: 0x0063, name: 'KC_KP_DOT', label: 'Keypad .', short: 'Num .' },
  { code: 0x0067, name: 'KC_KP_EQUAL', label: 'Keypad =', short: 'Num =' },

  // 系统键
  { code: 0x0065, name: 'KC_APP', label: 'App', short: 'App' },
  { code: 0x0066, name: 'KC_PWR', label: 'Power', short: 'Pwr' },
  { code: 0x0074, name: 'KC_EXEC', label: 'Execute', short: 'Exec' },
  { code: 0x0075, name: 'KC_HELP', label: 'Help', short: 'Help' },
  // HID Keyboard Menu (0x76)：VIA 显示为 Menu；与 0x65 Application 区分
  { code: 0x0076, name: 'KC_MENU', label: 'Menu', short: 'Menu' },
  { code: 0x0082, name: 'KC_SLEP', label: 'Sleep', short: 'Sleep' },
  { code: 0x0083, name: 'KC_WAKE', label: 'Wake', short: 'Wake' },

  // 修饰键
  { code: 0x00e0, name: 'KC_LCTL', label: 'L Ctrl', short: 'LCtl', aliases: ['LCTL'] },
  { code: 0x00e1, name: 'KC_LSFT', label: 'L Shift', short: 'LSft', aliases: ['LSFT'] },
  { code: 0x00e2, name: 'KC_LALT', label: 'L Alt', short: 'LAlt', aliases: ['LALT'] },
  { code: 0x00e3, name: 'KC_LGUI', label: 'L Win', short: 'LWin', aliases: ['LGUI', 'LWIN'] },
  { code: 0x00e4, name: 'KC_RCTL', label: 'R Ctrl', short: 'RCtl', aliases: ['RCTL'] },
  { code: 0x00e5, name: 'KC_RSFT', label: 'R Shift', short: 'RSft', aliases: ['RSFT'] },
  { code: 0x00e6, name: 'KC_RALT', label: 'R Alt', short: 'RAlt', aliases: ['RALT'] },
  { code: 0x00e7, name: 'KC_RGUI', label: 'R Win', short: 'RWin', aliases: ['RGUI', 'RWIN'] },
];

export const BASIC_KEYCODES: readonly KeycodeDef[] = ROWS.map((r) => ({
  code: r.code,
  name: r.name,
  label: r.label ?? r.name.replace(/^KC_/, ''),
  short: r.short,
  group: 'basic' as const,
  aliases: r.aliases,
}));
