// 开关：Radix Switch 的行为层 + Tailwind 外观。
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/shared/cn';

export interface SwitchProps {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly ariaLabel?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  ariaLabel,
}: SwitchProps): React.JSX.Element {
  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onCheckedChange={onCheckedChange}
      className={cn(
        'relative h-4 w-8 shrink-0 rounded-full',
        'transition-[background-color,box-shadow] duration-base ease-standard active:scale-[0.97]',
        'bg-border-strong data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-accent data-[state=checked]:to-accent-strong',
        'data-[state=checked]:shadow-glow',
        'shadow-inset-hl disabled:opacity-50',
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block h-3 w-3 translate-x-0.5 rounded-full bg-fg shadow-e1',
          /* 弹性曲线：拨动时轻微过冲再回弹，手感比线性更「有实体」 */
          'transition-transform duration-base ease-spring',
          'data-[state=checked]:translate-x-4.5 data-[state=checked]:bg-bg',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
