import type { SopTemplateOption } from '@/types';

/** SOP 模版选择器选项 — 与云端 AI 编排工作流对齐 */
export const SOP_TEMPLATES: SopTemplateOption[] = [
  { id: '10s-viral', label: '10秒爆款短视频 (5个分镜)', clips: 5 },
  { id: '15s-story', label: '15秒故事带货 (7个分镜)', clips: 7 },
  { id: '30s-deep', label: '30秒深度种草 (10个分镜)', clips: 10 },
  { id: '60s-tutorial', label: '60秒教程型 (15个分镜)', clips: 15 },
];
