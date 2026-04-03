/**
 * Persona Engine — 人设生成（规则 + 随机）
 * 让每个设备/会话「像一个人」，保证行为风格一致。
 */
import { Injectable } from '@nestjs/common';
import type { Persona, ActivityPattern, InteractionPreference } from './types';

const CITIES = ['Hangzhou', 'Shanghai', 'Beijing', 'Guangzhou', 'Shenzhen', 'Chengdu', 'Wuhan', 'Nanjing'];
const INTEREST_POOLS: Record<string, string[]> = {
  beauty: ['美妆', '穿搭', '护肤', '口红', '香水'],
  parenting: ['育儿', '早教', '母婴', '亲子'],
  tech: ['数码', '手机', '电脑', '游戏'],
  life: ['美食', '旅行', '健身', '读书'],
};

/** 简单确定性随机（基于 seed 的 mulberry32） */
function seededRandom(seed: number): () => number {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

@Injectable()
export class PersonaEngineService {
  /**
   * 生成或复用一个人设。
   * @param seed 设备/会话唯一标识，用于确定性随机（同一 seed 得到同一 persona_id 与风格）
   * @param overrides 可选覆盖字段（如指定兴趣）
   */
  generate(seed: string, overrides?: Partial<Persona>): Persona {
    const hash = seed.split('').reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0);
    const rnd = seededRandom(Math.abs(hash));

    const personaId = `p_${Math.abs(hash).toString(36)}`;
    const age = 18 + Math.floor(rnd() * 35);
    const gender = rnd() < 0.5 ? ('female' as const) : ('male' as const);
    const city = CITIES[Math.floor(rnd() * CITIES.length)];
    const poolKey = Object.keys(INTEREST_POOLS)[Math.floor(rnd() * Object.keys(INTEREST_POOLS).length)];
    const pool = INTEREST_POOLS[poolKey];
    const interestCount = 2 + Math.floor(rnd() * (pool.length - 1));
    const interests: string[] = [];
    const used = new Set<number>();
    while (interests.length < interestCount) {
      const i = Math.floor(rnd() * pool.length);
      if (!used.has(i)) {
        used.add(i);
        interests.push(pool[i]);
      }
    }

    const morning = 0.1 + rnd() * 0.4;
    const afternoon = 0.3 + rnd() * 0.4;
    const night = 0.4 + rnd() * 0.5;
    const sum = morning + afternoon + night;
    const activity_pattern: ActivityPattern = {
      morning: morning / sum,
      afternoon: afternoon / sum,
      night: night / sum,
    };

    const like = 0.4 + rnd() * 0.5;
    const comment = 0.1 + rnd() * 0.3;
    const share = 0.05 + rnd() * 0.15;
    const s = like + comment + share;
    const interaction_preference: InteractionPreference = {
      like: like / s,
      comment: comment / s,
      share: share / s,
    };

    const aggressiveness = 0.2 + rnd() * 0.5;

    const persona: Persona = {
      persona_id: overrides?.persona_id ?? personaId,
      age: overrides?.age ?? age,
      gender: overrides?.gender ?? gender,
      city: overrides?.city ?? city,
      interests: overrides?.interests ?? interests,
      activity_pattern: overrides?.activity_pattern ?? activity_pattern,
      aggressiveness: overrides?.aggressiveness ?? aggressiveness,
      interaction_preference: overrides?.interaction_preference ?? interaction_preference,
    };
    return persona;
  }
}
