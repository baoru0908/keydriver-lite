// 吉祥物形象（吉伊卡哇三只）：手绘 SVG，零外部素材、零依赖。
//
// 形象要点（按角色特征逐个还原）：
//  · 吉伊   chiikawa  —— 头大身小的圆润体型；头顶两侧小圆耳；两个小黑点眼；ω 形小嘴；短小手
//  · 哈奇   hachiware —— 同族体型；头顶一块深色「分头斑」，正中一条白线把斑分开；圆耳；小黑点眼
//  · 乌萨奇 usagi     —— 细长竖耳（明显更长）；竖长椭圆眼；元气张嘴露小舌
//
// 配色固定（奶油白 + 暖灰描边 + 角色各自特征色），不随主题变量走——
// 角色是「内容」不是「界面」，在深浅主题下都得是同一张脸。
//
// 表情由 mood 驱动眼形 / 嘴形 / 泪滴 / 小手，覆盖界面会遇到的场景。
// a11y：整体 role="img" + aria-label（角色名 + 情绪），纯装饰处由调用方 aria-hidden。
import { cn } from '@/shared/cn';

export type MascotWho = 'chiikawa' | 'hachiware' | 'usagi';
export type MascotMood = 'idle' | 'happy' | 'wait' | 'peek' | 'worry';

export const MASCOT_NAMES: Readonly<Record<MascotWho, string>> = {
  chiikawa: '吉伊',
  hachiware: '哈奇',
  usagi: '乌萨奇',
};

const FUR = '#fffdf6'; // 体色（极浅奶油白）
const LINE = '#9a8f7d'; // 描边（暖灰）
const BLUSH = '#ffbfcb'; // 腮红
const EYE = '#3d352c'; // 眼
const PATCH = '#7d8a99'; // 哈奇头顶分头斑（蓝灰）
const EAR_IN = '#f2c9d2'; // 耳内粉

export interface MascotProps {
  readonly who?: MascotWho;
  readonly mood?: MascotMood;
  /** 边长（px），按 1:1 方形绘制 */
  readonly size?: number;
  readonly className?: string;
  /** 入场动画（默认开：从触发点「长出来」，与浮层同一语言） */
  readonly animate?: boolean;
  /** 行内样式：主要用于错峰呼吸的 animation-delay */
  readonly style?: React.CSSProperties;
}

/** 眼形：三只的眼睛形状本来就不同，这是辨识度的核心。 */
function eyes(who: MascotWho, mood: MascotMood): React.JSX.Element {
  // 乌萨奇：竖长椭圆（睁大时更明显）
  const usagi = (
    <g fill={EYE}>
      <ellipse cx="19" cy="22" rx="1.5" ry="2.7" />
      <ellipse cx="29" cy="22" rx="1.5" ry="2.7" />
    </g>
  );
  const dots = (r: number) => (
    <g fill={EYE}>
      <circle cx="19" cy="22" r={r} />
      <circle cx="29" cy="22" r={r} />
    </g>
  );
  const happyArc = (
    <g fill="none" stroke={EYE} strokeWidth="1.8" strokeLinecap="round">
      <path d="M16.6 22.4q2.4 -2.6 4.8 0" />
      <path d="M26.6 22.4q2.4 -2.6 4.8 0" />
    </g>
  );
  const squint = (
    <g fill="none" stroke={EYE} strokeWidth="1.7" strokeLinecap="round">
      <path d="M16.8 22.4h4.4" />
      <path d="M26.8 22.4h4.4" />
    </g>
  );

  if (mood === 'happy') return happyArc;
  if (mood === 'wait') return squint;
  if (who === 'usagi') return usagi;
  // 吉伊眼距略窄、哈奇略大，用半径区分“品种感”
  return dots(who === 'hachiware' ? 1.9 : 1.6);
}

/** 嘴形：吉伊 ω、哈奇小三角、乌萨奇元气张嘴；情绪再叠一层。 */
function mouth(who: MascotWho, mood: MascotMood): React.JSX.Element {
  if (mood === 'happy') {
    // 大笑：开口 + 小舌
    return (
      <g>
        <path d="M20.4 26.6q3.6 4.8 7.2 0q-3.6 1.8 -7.2 0z" fill={EYE} />
        <path d="M22.2 29.4q1.8 1.6 3.6 0q-1.8 2.4 -3.6 0z" fill="#e58b9a" />
      </g>
    );
  }
  if (mood === 'worry') {
    // 担心 / 快哭：向下弯的小嘴
    return <path d="M21.2 28.6q2.8 -1.8 5.6 0" fill="none" stroke={EYE} strokeWidth="1.5" strokeLinecap="round" />;
  }
  if (mood === 'wait') {
    return <circle cx="24" cy="28" r="1.2" fill={EYE} />;
  }
  if (who === 'usagi') {
    // 元气张嘴
    return (
      <g>
        <path d="M21 26.8q3 3.6 6 0q-3 1.2 -6 0z" fill={EYE} />
      </g>
    );
  }
  if (who === 'hachiware') {
    return <path d="M21.6 27.4q2.4 2 4.8 0q-2.4 1 -4.8 0z" fill={EYE} />;
  }
  // 吉伊的 ω 小嘴
  return (
    <path
      d="M21.4 27.2q1.3 1.5 2.6 0q1.3 1.5 2.6 0"
      fill="none"
      stroke={EYE}
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  );
}

/**
 * 单只角色（48×48 坐标系）。头身比约 2:1——头大身小是这一族的体型特征。
 */
export function Mascot({
  who = 'chiikawa',
  mood = 'idle',
  size = 40,
  className,
  animate = true,
  style,
}: MascotProps): React.JSX.Element {
  const moodLabel =
    mood === 'happy' ? '开心' : mood === 'wait' ? '等待' : mood === 'peek' ? '张望' : mood === 'worry' ? '担心' : '平常';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label={`${MASCOT_NAMES[who]}（${moodLabel}）`}
      className={cn(animate && 'animate-pop', className)}
      style={style}
    >
      {/* —— 耳朵：乌萨奇细长竖耳，另外两只是小圆耳 —— */}
      {who === 'usagi' ? (
        <g stroke={LINE} strokeWidth="1.3">
          <ellipse cx="16.5" cy="11" rx="3.1" ry="9.6" fill={FUR} transform="rotate(-9 16.5 11)" />
          <ellipse cx="31.5" cy="11" rx="3.1" ry="9.6" fill={FUR} transform="rotate(9 31.5 11)" />
          <ellipse cx="16.8" cy="12.4" rx="1.3" ry="6.4" fill={EAR_IN} stroke="none" />
          <ellipse cx="31.2" cy="12.4" rx="1.3" ry="6.4" fill={EAR_IN} stroke="none" />
        </g>
      ) : (
        <g stroke={LINE} strokeWidth="1.3">
          <circle cx="13.5" cy="13.5" r="5" fill={FUR} />
          <circle cx="34.5" cy="13.5" r="5" fill={FUR} />
          <circle cx="13.5" cy="14" r="2.2" fill={EAR_IN} stroke="none" />
          <circle cx="34.5" cy="14" r="2.2" fill={EAR_IN} stroke="none" />
        </g>
      )}

      {/* —— 身体（小圆球）+ 头（大圆） —— */}
      <ellipse cx="24" cy="38" rx="10.5" ry="7.5" fill={FUR} stroke={LINE} strokeWidth="1.3" />
      <circle cx="24" cy="24" r="14.5" fill={FUR} stroke={LINE} strokeWidth="1.3" />

      {/* 哈奇的「分头斑」：头顶一块深色，正中一条白线把它分开 */}
      {who === 'hachiware' ? (
        <g>
          <path
            d="M24 9.6c6.4 0 11.4 3.4 12.6 8.2c-1.6 1.4 -3.6 2 -5.4 1.6c-2.2 1.6 -4.8 2.2 -7.2 2.2c-2.4 0 -5 -0.6 -7.2 -2.2c-1.8 0.4 -3.8 -0.2 -5.4 -1.6C12.6 13 17.6 9.6 24 9.6z"
            fill={PATCH}
          />
          <path d="M24 10.2v8.6" stroke={FUR} strokeWidth="2.2" strokeLinecap="round" />
        </g>
      ) : null}

      {/* 短手（身体两侧小圆） */}
      <g fill={FUR} stroke={LINE} strokeWidth="1.2">
        <circle cx="12.6" cy="33.5" r="3.2" />
        <circle cx="35.4" cy="33.5" r="3.2" />
      </g>

      {/* 腮红 */}
      <g fill={BLUSH} opacity="0.8">
        <ellipse cx="13.6" cy="26" rx="2.6" ry="1.8" />
        <ellipse cx="34.4" cy="26" rx="2.6" ry="1.8" />
      </g>

      {eyes(who, mood)}
      {mouth(who, mood)}

      {/* 担心时挂着的一滴泪（吉伊最常出现的表情） */}
      {mood === 'worry' ? <path d="M30.4 24.6q1.4 2.6 0 3.8q-1.4 -1.2 0 -3.8z" fill="#8ec9e8" /> : null}

      {/* 开心时举起的手 */}
      {mood === 'happy' ? (
        <g fill={FUR} stroke={LINE} strokeWidth="1.2">
          <circle cx="8.4" cy="28" r="3" />
          <circle cx="39.6" cy="28" r="3" />
        </g>
      ) : null}
    </svg>
  );
}

/** 三只排队：等待 / 加载场景用，错峰呼吸让画面「活着」但不吵。 */
export function MascotTrio({
  mood = 'wait',
  size = 30,
  className,
}: {
  readonly mood?: MascotMood;
  readonly size?: number;
  readonly className?: string;
}): React.JSX.Element {
  const order: readonly MascotWho[] = ['chiikawa', 'hachiware', 'usagi'];
  return (
    <span className={cn('flex items-end gap-0.5', className)} aria-hidden>
      {order.map((who, index) => (
        <Mascot
          key={who}
          who={who}
          mood={mood}
          size={size}
          animate={false}
          className="animate-breathe"
          // 错峰：三只不同步呼吸，避免机械感
          style={{ animationDelay: `${index * 220}ms` }}
        />
      ))}
    </span>
  );
}

/** 台词气泡：让角色真的「说话」，而不是当装饰站着。 */
export function MascotBubble({
  who = 'chiikawa',
  line,
  className,
}: {
  readonly who?: MascotWho;
  readonly line: string;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Mascot who={who} mood="peek" size={28} animate={false} />
      <span className="relative rounded-card border border-border bg-surface px-2.5 py-1 text-caption text-fg-muted shadow-e1">
        {line}
        <span
          aria-hidden
          className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-b border-l border-border bg-surface"
        />
      </span>
    </span>
  );
}
