'use client';

import type { ComponentType } from 'react';

/**
 * 龙虾智能池 — 9 大「智能龙虾」专属 SVG
 * 极简线框、抽象几何、未来感；主体为身披不同铠甲、释放不同异能光束的智能龙虾
 * 统一 viewBox 0 0 32 32，可传 color / size
 */

import type { CustomLobsterAgentId } from '@/data/custom-lobster-agents';

const DEFAULT_SIZE = 24;

interface AgentSvgProps {
  color?: string;
  size?: number;
  className?: string;
}

/** 1. 触须虾 — 量子装甲，双触角全向天线阵列，霓虹探测波纹 #00CF92 */
export function SvgRadar({ color = '#00CF92', size = DEFAULT_SIZE, className = '' }: AgentSvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* 龙虾头胸 */}
      <ellipse cx="16" cy="14" rx="6" ry="5" opacity={0.9} />
      {/* 双螯简化 */}
      <path d="M10 12v2M22 12v2" opacity={0.7} />
      {/* 两条主触角：全向天线阵列 */}
      <path d="M14 10 Q12 4 14 2 M18 10 Q20 4 18 2" strokeWidth="1.4" />
      <circle cx="14" cy="2" r="1.2" fill={color} opacity={0.9} />
      <circle cx="18" cy="2" r="1.2" fill={color} opacity={0.9} />
      {/* 霓虹探测波纹 */}
      <circle cx="16" cy="14" r="8" fill="none" opacity={0.45} strokeDasharray="2 2" />
      <circle cx="16" cy="14" r="11" fill="none" opacity={0.3} strokeDasharray="2 2" />
      {/* 腹节 + 尾扇 */}
      <path d="M16 19 L14 28 L16 30 L18 28 Z" opacity={0.8} />
    </svg>
  );
}

/** 2. 脑虫虾 — 正面龙虾头盔，半透明头壳内发光神经网络 #F5C400 */
export function SvgStrategist({ color = '#F5C400', size = DEFAULT_SIZE, className = '' }: AgentSvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* 正面头盔轮廓 */}
      <path d="M16 4 L24 10 L24 18 Q24 24 16 28 Q8 24 8 18 L8 10 Z" fill={color} fillOpacity={0.08} />
      <path d="M16 4 L24 10 L24 18 Q24 24 16 28 Q8 24 8 18 L8 10 Z" />
      {/* 复眼 */}
      <ellipse cx="12" cy="12" rx="2.5" ry="2" opacity={0.6} />
      <ellipse cx="20" cy="12" rx="2.5" ry="2" opacity={0.6} />
      {/* 内部发光神经网络 */}
      <circle cx="16" cy="16" r="3" fill={color} fillOpacity={0.25} stroke={color} />
      <path d="M16 13 L16 19 M13 16 L19 16 M14 14 L18 18 M18 14 L14 18" opacity={0.9} />
      <circle cx="16" cy="14" r="0.8" fill={color} />
      <circle cx="14" cy="16" r="0.8" fill={color} />
      <circle cx="18" cy="16" r="0.8" fill={color} />
      <circle cx="16" cy="18" r="0.8" fill={color} />
    </svg>
  );
}

/** 3. 吐墨虾 — 侧视，螯改造成书法笔尖，在文字光带上勾勒 #8F5BFB */
export function SvgInkWriter({ color = '#8F5BFB', size = DEFAULT_SIZE, className = '' }: AgentSvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* 龙虾侧影：头胸 */}
      <ellipse cx="10" cy="14" rx="5" ry="6" opacity={0.85} />
      {/* 螯改造成笔尖 */}
      <path d="M14 10 L22 6 L24 10 L22 14 L14 12 Z" fill={color} fillOpacity={0.2} />
      <path d="M14 10 L22 6 L24 10 L22 14 L14 12 Z" />
      <path d="M22 8 L26 4" strokeWidth="1.5" />
      {/* 流动文字光带 */}
      <path d="M4 20 Q12 18 20 20 Q28 22 28 26" strokeDasharray="3 2" opacity={0.9} />
      <path d="M6 24 Q14 22 22 24" strokeDasharray="2 2" opacity={0.6} />
      {/* 腹节 */}
      <path d="M8 20 L6 28 L10 30 L12 28 Z" opacity={0.7} />
    </svg>
  );
}

/** 4. 幻影虾 — 几何切割剔透龙虾，复眼大透镜，向前投影 3D 粒子 #1D9BF0 */
export function SvgVisualizer({ color = '#1D9BF0', size = DEFAULT_SIZE, className = '' }: AgentSvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* 几何切割身体：三角/菱形 */}
      <path d="M16 6 L26 14 L22 24 L10 24 L6 14 Z" fill={color} fillOpacity={0.06} />
      <path d="M16 6 L26 14 L22 24 L10 24 L6 14 Z" />
      <path d="M16 6 L16 24 M6 14 L26 14" opacity={0.5} />
      {/* 复眼大透镜 */}
      <circle cx="12" cy="12" r="4" fill="none" stroke={color} opacity={0.8} />
      <circle cx="20" cy="12" r="4" fill="none" stroke={color} opacity={0.8} />
      <circle cx="12" cy="12" r="1.5" fill={color} fillOpacity={0.4} />
      <circle cx="20" cy="12" r="1.5" fill={color} fillOpacity={0.4} />
      {/* 向前投影 3D 粒子 */}
      <circle cx="28" cy="10" r="1" fill={color} opacity={0.9} />
      <circle cx="30" cy="16" r="0.8" fill={color} opacity={0.7} />
      <circle cx="28" cy="22" r="1" fill={color} opacity={0.9} />
      <path d="M24 14 L27 14 M24 18 L26 16" opacity={0.5} />
    </svg>
  );
}

/** 5. 点兵虾 — 蜂巢控制装甲，身体分块发射虚线连边缘节点 #007AFF */
export function SvgDispatcher({ color = '#007AFF', size = DEFAULT_SIZE, className = '' }: AgentSvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* 蜂巢身体：三块六边形 */}
      <path d="M16 4 L22 8 L22 14 L16 18 L10 14 L10 8 Z" fill={color} fillOpacity={0.1} />
      <path d="M16 4 L22 8 L22 14 L16 18 L10 14 L10 8 Z" />
      <path d="M16 10 L22 14 L22 20 L16 24 L10 20 L10 14 Z" fill={color} fillOpacity={0.06} />
      <path d="M16 10 L22 14 L22 20 L16 24 L10 20 L10 14 Z" />
      <path d="M16 16 L22 20 L22 26 L16 30 L10 26 L10 20 Z" fill={color} fillOpacity={0.04} />
      <path d="M16 16 L22 20 L22 26 L16 30 L10 26 L10 20 Z" />
      {/* 虚线数据路径连边缘节点 */}
      <path d="M22 11 L28 8" strokeDasharray="2 2" opacity={0.9} />
      <path d="M22 17 L30 18" strokeDasharray="2 2" opacity={0.9} />
      <path d="M10 17 L2 18" strokeDasharray="2 2" opacity={0.9} />
      <path d="M10 23 L4 30" strokeDasharray="2 2" opacity={0.9} />
      <circle cx="28" cy="8" r="1.5" fill={color} opacity={0.8} />
      <circle cx="30" cy="18" r="1.5" fill={color} opacity={0.8} />
      <circle cx="2" cy="18" r="1.5" fill={color} opacity={0.8} />
      <circle cx="4" cy="30" r="1.5" fill={color} opacity={0.8} />
    </svg>
  );
}

/** 6. 回声虾 — 双螯相对成对话气泡，内有声波与符号 #FF4757 */
export function SvgEchoer({ color = '#FF4757', size = DEFAULT_SIZE, className = '' }: AgentSvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* 左螯 */}
      <path d="M6 12 Q2 16 4 22 Q6 26 10 24 L12 20" fill={color} fillOpacity={0.08} />
      <path d="M6 12 Q2 16 4 22 Q6 26 10 24 L12 20" />
      {/* 右螯 */}
      <path d="M26 12 Q30 16 28 22 Q26 26 22 24 L20 20" fill={color} fillOpacity={0.08} />
      <path d="M26 12 Q30 16 28 22 Q26 26 22 24 L20 20" />
      {/* 对话气泡 */}
      <path d="M12 14 L20 14 Q24 14 24 20 Q24 26 16 26 Q10 26 10 20 Z" fill={color} fillOpacity={0.12} />
      <path d="M12 14 L20 14 Q24 14 24 20 Q24 26 16 26 Q10 26 10 20 Z" />
      {/* 声波纹理 */}
      <path d="M14 18 Q16 16 18 18 Q20 20 18 22" opacity={0.9} />
      <path d="M18 16 Q20 18 18 20" opacity={0.6} />
      {/* Emoji 点 */}
      <circle cx="16" cy="22" r="1.2" fill={color} opacity={0.8} />
    </svg>
  );
}

/** 7. 铁网虾 — 铁螯陷阱装甲，双螯合并成数字陷阱网，捕获意图粒子 #FF9F43 */
export function SvgCatcher({ color = '#FF9F43', size = DEFAULT_SIZE, className = '' }: AgentSvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* 双螯合并成网：外框 */}
      <path d="M8 8 L24 8 L28 16 L24 24 L8 24 L4 16 Z" fill={color} fillOpacity={0.06} />
      <path d="M8 8 L24 8 L28 16 L24 24 L8 24 L4 16 Z" />
      {/* 陷阱网格 */}
      <path d="M8 8 L4 16 L8 24 M24 8 L28 16 L24 24 M8 8 L16 4 L24 8 M8 24 L16 28 L24 24" opacity={0.8} />
      <path d="M16 4 L16 28 M10 12 L22 12 M10 20 L22 20 M10 12 L10 20 M22 12 L22 20" strokeDasharray="1 1" opacity={0.7} />
      {/* 意图粒子 */}
      <circle cx="16" cy="14" r="1.5" fill={color} opacity={0.9} />
      <circle cx="12" cy="18" r="1" fill={color} opacity={0.7} />
      <circle cx="20" cy="18" r="1" fill={color} opacity={0.7} />
      {/* 龙虾头胸暗示 */}
      <ellipse cx="16" cy="28" rx="5" ry="2" opacity={0.5} />
    </svg>
  );
}

/** 8. 金算虾 — 侧视，体节为算盘珠带龙虾图腾，身体向上倾斜 #FF6B00 */
export function SvgAbacus({ color = '#FF6B00', size = DEFAULT_SIZE, className = '' }: AgentSvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* 倾斜身体轴线 */}
      <path d="M6 26 L26 8" opacity={0.3} />
      {/* 算珠节段（椭圆珠） */}
      <ellipse cx="8" cy="22" rx="3" ry="4" fill={color} fillOpacity={0.2} />
      <ellipse cx="8" cy="22" rx="3" ry="4" />
      <ellipse cx="14" cy="18" rx="3" ry="4" fill={color} fillOpacity={0.15} />
      <ellipse cx="14" cy="18" rx="3" ry="4" />
      <ellipse cx="20" cy="14" rx="3" ry="4" fill={color} fillOpacity={0.25} />
      <ellipse cx="20" cy="14" rx="3" ry="4" />
      <ellipse cx="26" cy="10" rx="3" ry="4" fill={color} fillOpacity={0.2} />
      <ellipse cx="26" cy="10" rx="3" ry="4" />
      {/* 龙虾图腾：中间一珠上 V 形 */}
      <path d="M20 12 L19 15 L21 15 Z" fill={color} opacity={0.8} />
      {/* 头与螯 */}
      <circle cx="28" cy="6" r="2.5" fill={color} fillOpacity={0.1} />
      <circle cx="28" cy="6" r="2.5" />
      <path d="M26 5 L25 3 M30 5 L31 3" opacity={0.7} />
    </svg>
  );
}

/** 9. 回访虾 — 优雅卷曲，尾部为带频谱与计时的电话听筒，螯托举 #00E676 */
export function SvgFollowUp({ color = '#00E676', size = DEFAULT_SIZE, className = '' }: AgentSvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* 卷曲身体弧 */}
      <path d="M8 28 Q6 20 10 14 Q14 8 20 6" fill="none" opacity={0.8} />
      {/* 尾部 = 电话听筒 */}
      <path d="M18 6 L28 4 L30 8 L28 12 L18 10 Z" fill={color} fillOpacity={0.15} />
      <path d="M18 6 L28 4 L30 8 L28 12 L18 10 Z" />
      <path d="M20 7 L26 7 M20 9 L26 9" opacity={0.7} />
      {/* 音频频谱 */}
      <path d="M30 6 L32 6 M30 8 L32 7 M30 10 L32 9" strokeWidth="1" opacity={0.8} />
      {/* 螯托举听筒 */}
      <path d="M12 12 Q10 8 14 6 L16 8" fill={color} fillOpacity={0.1} />
      <path d="M12 12 Q10 8 14 6 L16 8" />
      {/* 头胸 */}
      <ellipse cx="10" cy="18" rx="4" ry="5" fill={color} fillOpacity={0.08} />
      <ellipse cx="10" cy="18" rx="4" ry="5" />
      <path d="M8 22 L8 26 L12 28 L14 26" opacity={0.6} />
    </svg>
  );
}

const SVG_MAP: Record<CustomLobsterAgentId, ComponentType<AgentSvgProps>> = {
  radar: SvgRadar,
  strategist: SvgStrategist,
  inkwriter: SvgInkWriter,
  visualizer: SvgVisualizer,
  dispatcher: SvgDispatcher,
  echoer: SvgEchoer,
  catcher: SvgCatcher,
  abacus: SvgAbacus,
  followup: SvgFollowUp,
};

export function AgentPodIcon({
  agentId,
  color,
  size = 24,
  className = '',
}: AgentSvgProps & { agentId: CustomLobsterAgentId }) {
  const Icon = SVG_MAP[agentId] ?? SvgStrategist;
  return <Icon color={color} size={size} className={className} />;
}
