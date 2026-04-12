/**
 * Visualizer — 幻影虾
 * 视觉生产：分镜脚本、AI 图像生成、封面设计、数字人视频
 * 对应 Python v2: dragon-senate-saas-v2/lobsters/visualizer
 */
export const AGENT_ID = 'visualizer' as const;
export const AGENT_NAME = '幻影虾';
export const AGENT_NAME_EN = 'Visualizer';
export const AGENT_ICON = '🎬';
export const AGENT_PHASE = '③-B 视觉';
export const AGENT_ROLE = '视觉生产';
export const AGENT_MODEL_TIER = 'reasoning';

export const AGENT_SKILLS = [
  'visualizer_storyboard',
  'visualizer_ai_prompt',
  'visualizer_image_gen',
  'visualizer_cover_design',
  'visualizer_digital_human_script',
  'visualizer_digital_human_video',
  'visualizer_video_edit',
  'visualizer_subtitle_gen',
  'visualizer_semantic_material_match',
  'visualizer_subtitle_fx_bgm',
  'visualizer_cover_ab_generate',
] as const;
