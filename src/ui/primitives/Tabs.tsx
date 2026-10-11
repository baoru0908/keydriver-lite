// 标签页（T06-5）：Radix Tabs 行为层 + 令牌外观。选中态由 data-state 驱动，无手搓逻辑。
// Root 支持受控（value + onValueChange）；Content 可选（如键码面板搜索态接管内容区）。
import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentProps } from 'react';
import { cn } from '@/shared/cn';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('flex flex-wrap gap-1', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'rounded px-2 py-1 text-caption transition-colors duration-fast ease-standard active:scale-[0.97]',
        'bg-elevated text-fg-muted hover:text-fg',
        'data-[state=active]:bg-accent data-[state=active]:text-bg',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn('animate-fade-up outline-none', className)}
      {...props}
    />
  );
}
