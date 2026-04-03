'use client';

import { createContext, useContext, useCallback, useState } from 'react';
import type { Campaign, CalendarTask } from '@/types/calendar';

interface CampaignStoreValue {
  campaigns: Campaign[];
  tasks: CalendarTask[];
  selectedCampaignId: string | null;
  setSelectedCampaignId: (id: string | null) => void;
  addCampaignWithTickets: (campaignName: string, tickets: Omit<CalendarTask, 'campaignId' | 'campaignName'>[]) => Campaign;
  updateTask: (taskId: string, patch: Partial<CalendarTask>) => void;
}

const CampaignStoreContext = createContext<CampaignStoreValue | null>(null);

function seedInitialTasks(): CalendarTask[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const todayKey = now.getFullYear() + '-' + String(m + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const fmt = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return [
    { id: 't1', platform: 'douyin', accountName: '种草账号 A', publishDate: fmt(new Date(y, m, 5)), publishTime: '14:30', status: 'sent', nodeId: 'Node-01' },
    { id: 't2', platform: 'xiaohongshu', accountName: '美妆账号 B', publishDate: fmt(new Date(y, m, 5)), publishTime: '14:32', status: 'queued', nodeId: 'Node-02' },
    { id: 't3', platform: 'douyin', accountName: '带货账号 C', publishDate: fmt(new Date(y, m, 7)), publishTime: '09:00', status: 'queued', nodeId: 'Node-01' },
    { id: 't4', platform: 'xiaohongshu', accountName: '种草账号 A', publishDate: fmt(new Date(y, m, 7)), publishTime: '18:00', status: 'sent', nodeId: 'Node-02' },
    { id: 't5', platform: 'douyin', accountName: '种草账号 A', publishDate: todayKey, publishTime: '10:00', status: 'sent', nodeId: 'Node-01' },
    { id: 't6', platform: 'xiaohongshu', accountName: '美妆账号 B', publishDate: todayKey, publishTime: '14:00', status: 'queued', nodeId: 'Node-02' },
    { id: 't7', platform: 'douyin', accountName: '带货账号 C', publishDate: todayKey, publishTime: '16:30', status: 'queued', nodeId: 'Node-03' },
    { id: 't8', platform: 'xiaohongshu', accountName: '种草账号 A', publishDate: fmt(new Date(y, m, 12)), publishTime: '12:00', status: 'offline', nodeId: 'Node-02' },
    { id: 't9', platform: 'douyin', accountName: '美妆账号 B', publishDate: fmt(new Date(y, m, 15)), publishTime: '20:00', status: 'queued', nodeId: 'Node-01' },
    { id: 't10', platform: 'xiaohongshu', accountName: '带货账号 C', publishDate: fmt(new Date(y, m, 18)), publishTime: '11:30', status: 'queued', nodeId: 'Node-03' },
  ];
}

export function CampaignStoreProvider({ children }: { children: React.ReactNode }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tasks, setTasks] = useState<CalendarTask[]>(seedInitialTasks);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  const addCampaignWithTickets = useCallback(
    (campaignName: string, tickets: Omit<CalendarTask, 'campaignId' | 'campaignName'>[]) => {
      const id = 'camp-' + Date.now();
      const campaign: Campaign = {
        id,
        name: campaignName,
        totalTickets: tickets.length,
        createdAt: new Date().toISOString(),
      };
      const shortName = campaignName.length > 8 ? campaignName.slice(0, 6) + '…' : campaignName;
      const withCampaign: CalendarTask[] = tickets.map((t) => ({
        ...t,
        campaignId: id,
        campaignName: shortName,
      }));
      setCampaigns((prev) => [...prev, campaign]);
      setTasks((prev) => [...prev, ...withCampaign]);
      return campaign;
    },
    [],
  );

  const updateTask = useCallback((taskId: string, patch: Partial<CalendarTask>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
    );
  }, []);

  const value: CampaignStoreValue = {
    campaigns,
    tasks,
    selectedCampaignId,
    setSelectedCampaignId,
    addCampaignWithTickets,
    updateTask,
  };

  return (
    <CampaignStoreContext.Provider value={value}>
      {children}
    </CampaignStoreContext.Provider>
  );
}

export function useCampaignStore(): CampaignStoreValue {
  const ctx = useContext(CampaignStoreContext);
  if (!ctx) {
    throw new Error('useCampaignStore must be used within CampaignStoreProvider');
  }
  return ctx;
}
