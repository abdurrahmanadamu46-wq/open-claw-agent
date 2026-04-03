export type EdgePersonaMaskId =
  | 'mom-community'
  | 'female-college'
  | 'male-college'
  | 'premium-white-collar'
  | 'budget-hunter'
  | 'urban-new-family';

export interface EdgePersonaMask {
  id: EdgePersonaMaskId;
  name: string;
  emoji: string;
  identity: string;
  narrativeTone: string;
  interests: string[];
  activeWindows: string[];
  contentBias: string[];
  otaVersion: string;
  authorized: boolean;
}

export const EDGE_PERSONA_MASKS: EdgePersonaMask[] = [
  {
    id: 'mom-community',
    name: '宝妈社区面具',
    emoji: '🧑‍🍼',
    identity: '28-35 岁宝妈',
    narrativeTone: '真实生活感、经验分享、低营销压迫',
    interests: ['育儿经验', '家庭好物', '省钱攻略'],
    activeWindows: ['07:00-09:00', '12:00-14:00', '21:00-23:30'],
    contentBias: ['笔记口吻', '情绪共鸣', '评论互动'],
    otaVersion: 'mask-v2.4.0',
    authorized: true,
  },
  {
    id: 'female-college',
    name: '女大学生面具',
    emoji: '🎓',
    identity: '18-23 岁女大学生',
    narrativeTone: '轻松分享、体验导向、高互动',
    interests: ['校园生活', '美妆穿搭', '平价好物'],
    activeWindows: ['11:30-13:30', '18:30-20:00', '22:00-01:00'],
    contentBias: ['种草内容', '短句评论', '高频点赞'],
    otaVersion: 'mask-v1.9.2',
    authorized: true,
  },
  {
    id: 'male-college',
    name: '男大学生面具',
    emoji: '🧢',
    identity: '18-24 岁男大学生',
    narrativeTone: '直接、理性、轻幽默',
    interests: ['数码测评', '运动健身', '游戏内容'],
    activeWindows: ['12:00-14:00', '20:00-22:00', '23:00-01:30'],
    contentBias: ['参数对比', '问题导向', '测评风'],
    otaVersion: 'mask-v1.7.6',
    authorized: true,
  },
  {
    id: 'premium-white-collar',
    name: '都市白领面具',
    emoji: '💼',
    identity: '25-33 岁一线白领',
    narrativeTone: '克制、专业、结论优先',
    interests: ['效率工具', '职业成长', '消费决策'],
    activeWindows: ['08:00-09:30', '12:00-13:30', '20:30-23:00'],
    contentBias: ['结论先行', '数据支撑', '高质量问答'],
    otaVersion: 'mask-v1.3.1',
    authorized: true,
  },
  {
    id: 'budget-hunter',
    name: '精打细算面具',
    emoji: '🛒',
    identity: '22-40 岁价格敏感人群',
    narrativeTone: '实用、直接、对比明确',
    interests: ['活动折扣', '券后价', '替代方案'],
    activeWindows: ['10:00-12:00', '19:00-21:00'],
    contentBias: ['价格对比', '口碑搬运', '冲突点提问'],
    otaVersion: 'mask-v1.2.5',
    authorized: true,
  },
  {
    id: 'urban-new-family',
    name: '新家庭生活面具',
    emoji: '🏠',
    identity: '24-36 岁新婚/新家庭',
    narrativeTone: '温和、场景化、长期价值',
    interests: ['家居生活', '健康饮食', '家庭预算'],
    activeWindows: ['07:30-09:00', '18:30-22:30'],
    contentBias: ['场景叙事', '清单式推荐', '口碑追踪'],
    otaVersion: 'mask-v1.0.8',
    authorized: true,
  },
];

