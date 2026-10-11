// 角色形象的渲染测试：锁定三只的辨识特征（耳朵 / 斑纹 / 表情），
// 防止后续重构把「像不像」改没了——这些特征是主题体验的一部分。
import { createElement as h } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Mascot, MASCOT_NAMES, MascotBubble, MascotTrio } from '../mascots';

const html = (who: 'chiikawa' | 'hachiware' | 'usagi', mood?: 'idle' | 'happy' | 'wait' | 'peek' | 'worry'): string =>
  renderToStaticMarkup(h(Mascot, { who, mood, size: 48, animate: false }));

describe('吉祥物形象', () => {
  it('三只各带角色名 aria-label', () => {
    for (const who of ['chiikawa', 'hachiware', 'usagi'] as const) {
      expect(html(who)).toContain(`aria-label="${MASCOT_NAMES[who]}（平常）"`);
    }
  });

  it('哈奇独有头顶分头斑（蓝灰斑 + 白色分线）', () => {
    expect(html('hachiware')).toContain('#7d8a99');
    expect(html('chiikawa')).not.toContain('#7d8a99');
    expect(html('usagi')).not.toContain('#7d8a99');
  });

  it('乌萨奇独有细长竖耳（ry 明显大于圆耳）', () => {
    const usagi = html('usagi');
    expect(usagi).toMatch(/rx="3\.1" ry="9\.6"/);
    // 圆耳小圆（吉伊/哈奇的耳形）不应出现在乌萨奇
    expect(usagi).not.toContain('cx="13.5" cy="13.5"');
  });

  it('吉伊独有 ω 形小嘴', () => {
    expect(html('chiikawa')).toContain('M21.4 27.2');
    expect(html('hachiware')).not.toContain('M21.4 27.2');
  });

  it('开心情绪有举起的小手；担心情绪有泪滴', () => {
    expect(html('chiikawa', 'happy')).toContain('cx="8.4" cy="28"');
    expect(html('chiikawa', 'worry')).toContain('#8ec9e8');
    expect(html('chiikawa', 'idle')).not.toContain('#8ec9e8');
  });

  it('三只排队与台词气泡正常渲染', () => {
    const trio = renderToStaticMarkup(h(MascotTrio, { mood: 'wait', size: 30 }));
    expect((trio.match(/<svg /g) ?? []).length).toBe(3);
    const bubble = renderToStaticMarkup(h(MascotBubble, { who: 'hachiware', line: '稍等一下哦' }));
    expect(bubble).toContain('稍等一下哦');
  });
});
