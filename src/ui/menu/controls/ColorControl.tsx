// color 控件：QMK RGB Matrix 语义 = [hue, sat] 两个字节（id_qmk_rgb_matrix_color）。
// 与原版 VIA 官方一致（custom-control.tsx：`props.value as [hue, sat]`，
// `updateValue(name, ...command, hue, sat)`）——固件只有 hue/sat 两个字节，没有色空间概念。
// 存储值 16 位 (h<<8)|s；亮度（v）由固件的 brightness 控制，不在此控件内。
// 之前自创的「3 字节 + HSV/RGB/GRB 色空间切换」是把 RGB 字节写进固件的 hue/sat 位，
// 灯效颜色全部错乱（真机实证），已废弃。
import type { ControlSpec } from '@/definition/schema';
import { useControlValue } from '@/store/useMenuStore';
import { useDeviceStore } from '@/store/useDeviceStore';
import { ColorPicker } from '@/ui/primitives/ColorPicker';

export interface ColorControlProps {
  readonly control: ControlSpec;
  readonly disabled?: boolean;
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = clamp255(r) / 255;
  const gn = clamp255(g) / 255;
  const bn = clamp255(b) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [Math.round((h / 360) * 255), Math.round(s * 255), Math.round(max * 255)];
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hn = ((clamp255(h) / 255) * 360) % 360;
  const sn = clamp255(s) / 255;
  const vn = clamp255(v) / 255;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = vn - c;
  let rgb: [number, number, number];
  if (hn < 60) rgb = [c, x, 0];
  else if (hn < 120) rgb = [x, c, 0];
  else if (hn < 180) rgb = [0, c, x];
  else if (hn < 240) rgb = [0, x, c];
  else if (hn < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return {
    r: clamp255((rgb[0] + m) * 255),
    g: clamp255((rgb[1] + m) * 255),
    b: clamp255((rgb[2] + m) * 255),
  };
}

function toHex(rgb: { r: number; g: number; b: number }): string {
  return `#${((1 << 24) | (rgb.r << 16) | (rgb.g << 8) | rgb.b).toString(16).slice(1)}`;
}

export function ColorControl({ control, disabled }: ColorControlProps): React.JSX.Element {
  const value = useControlValue(control);
  const menuCommit = useDeviceStore((s) => s.menuCommit);
  const hue = (value >> 8) & 0xff;
  const sat = value & 0xff;
  const rgb = hsvToRgb(hue, sat, 255);
  const hex = toHex(rgb);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-end gap-1">
          <div
            className="h-8 w-16 rounded-card border border-border"
            style={{ backgroundColor: hex }}
          />
          <span className="font-mono text-[10px] text-fg-dim">{hex.toUpperCase()}</span>
        </div>
        <div className={disabled ? 'pointer-events-none opacity-50' : ''}>
          <ColorPicker
            value={(rgb.r << 16) | (rgb.g << 8) | rgb.b}
            onChange={(next) => {
              const [h, s] = rgbToHsv((next >> 16) & 0xff, (next >> 8) & 0xff, next & 0xff);
              // 固件只有 hue/sat：v 恒满（亮度走 Brightness 控件）
              void menuCommit(control, (h << 8) | s);
            }}
          />
        </div>
      </div>
    </div>
  );
}
