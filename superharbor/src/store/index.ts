/**
 * SuperHarbor 全局状态 — Zustand
 */

import { create } from 'zustand';
import type { EdgeNode, CampaignTask, Lead } from '@/types';

interface DashboardState {
  onlineNodeCount: number;
  tokensConsumedToday: number;
  tasksDispatchedToday: number;
  nodes: EdgeNode[];
  setNodes: (nodes: EdgeNode[]) => void;
  setMetrics: (m: { onlineNodeCount?: number; tokensConsumedToday?: number; tasksDispatchedToday?: number }) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  onlineNodeCount: 0,
  tokensConsumedToday: 0,
  tasksDispatchedToday: 0,
  nodes: [],
  setNodes: (nodes) => set({ nodes, onlineNodeCount: nodes.filter((n) => n.status === 'online').length }),
  setMetrics: (m) => set(m),
}));

interface CampaignsState {
  campaigns: CampaignTask[];
  setCampaigns: (c: CampaignTask[]) => void;
  addCampaign: (c: CampaignTask) => void;
}

export const useCampaignsStore = create<CampaignsState>((set) => ({
  campaigns: [],
  setCampaigns: (campaigns) => set({ campaigns }),
  addCampaign: (c) => set((s) => ({ campaigns: [c, ...s.campaigns] })),
}));

interface LeadsState {
  leads: Lead[];
  setLeads: (l: Lead[]) => void;
}

export const useLeadsStore = create<LeadsState>((set) => ({
  leads: [],
  setLeads: (leads) => set({ leads }),
}));
