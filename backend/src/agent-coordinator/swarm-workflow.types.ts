/**
 * LangGraph Swarm 蜂群状态类型
 * 支持动态移交 (Dynamic Handoff)：编剧 → 审核 → 违规则回编剧重写
 */

export interface SwarmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface VideoDraft {
  /** 脚本类型 */
  template_type: string;
  /** 分镜/段落 */
  scenes: Array<{ index: number; text: string; type?: string }>;
  /** 审核员标注的违规原因（若被打回） */
  rejection_reason?: string;
}

export interface SwarmState {
  messages: SwarmMessage[];
  current_agent: string;
  video_draft: VideoDraft | null;
}
