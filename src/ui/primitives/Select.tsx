// 下拉选择：Radix Select 包装，支持 { label, value }[] 形态（定义文件归一化后的形态）。
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/shared/cn';

export interface SelectOption {
  readonly label: string;
  readonly value: number;
}

export interface SelectProps {
  readonly value: number;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: number) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly className?: string;
}

export function Select({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled,
  ariaLabel,
  className,
}: SelectProps): React.JSX.Element {
  const selected = options.find((o) => o.value === value);
  return (
    <SelectPrimitive.Root
      value={String(value)}
      disabled={disabled}
      onValueChange={(next) => onChange(Number.parseInt(next, 10))}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          'flex h-7 w-full items-center justify-between gap-2 rounded-card border border-border bg-elevated px-2 text-xs text-fg',
          'shadow-inset-hl transition-[border-color,box-shadow,background-color] duration-fast ease-standard',
          'hover:border-border-strong disabled:opacity-50',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder}>
          {selected?.label ?? placeholder}
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon>
          <ChevronDown size={13} className="text-fg-dim" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="glass-panel z-50 max-h-64 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg shadow-e3 animate-scale"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={String(option.value)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-fg-muted outline-none',
                  'transition-colors duration-fast ease-standard',
                  'data-[highlighted]:bg-elevated data-[highlighted]:text-fg',
                  'data-[state=checked]:bg-accent-soft data-[state=checked]:text-accent',
                )}
              >
                <SelectPrimitive.ItemIndicator>
                  <Check size={12} />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
