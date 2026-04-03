/**
 * 业务服务层 — 战役编排：调用外部 AI（故事→分镜、图生、视频生），不自研模型
 */

import { storyToStoryboard, generateImage, generateVideo, type StoryboardShot } from './ai/external';

export interface CreateCampaignInput {
  productName: string;
  sellPoints: string;
  targetAccountUrls?: string[];
  sopTemplateId: string;
  clips: number;
}

export interface CreateCampaignResult {
  campaignId: string;
  storyboard: StoryboardShot[];
  imageUrl?: string;
  videoUrl?: string;
}

const campaignStore = new Map<string, CreateCampaignResult>();

export async function createCampaign(input: CreateCampaignInput): Promise<CreateCampaignResult> {
  const story = [input.productName, input.sellPoints].filter(Boolean).join('\n');
  const storyboardResult = await storyToStoryboard(story, { clips: input.clips });
  const campaignId = `camp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const imageResult = await generateImage(`商品图：${input.productName}`);
  const videoResult = await generateVideo(storyboardResult.shots);

  const result: CreateCampaignResult = {
    campaignId,
    storyboard: storyboardResult.shots,
    imageUrl: imageResult.url,
    videoUrl: videoResult.url,
  };
  campaignStore.set(campaignId, result);
  return result;
}

export function getCampaign(campaignId: string): CreateCampaignResult | undefined {
  return campaignStore.get(campaignId);
}
