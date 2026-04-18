'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';

/** 单条风控熔断告警（用于异常告警中心展示） */
export interface InterventionAlert {
  nodeId: string;
  clientName: string;
  reason?: string;
}

/** XHS Commander 轻量提醒，用于把高风险队列和任务状态抬到全局提醒层 */
export interface XhsCommanderAlert {
  id: string;
  kind: 'queue_open' | 'task_running';
  title: string;
  detail?: string;
  href?: string;
}

type AlertCenterValue = {
  interventionAlerts: InterventionAlert[];
  setInterventionAlerts: (alerts: InterventionAlert[]) => void;
  xhsCommanderAlerts: XhsCommanderAlert[];
  setXhsCommanderAlerts: (alerts: XhsCommanderAlert[]) => void;
  syncDismissedXhsCommanderAlerts: (ids: string[]) => void;
  dismissXhsCommanderAlert: (alertId: string) => void;
  clearDismissedXhsCommanderAlerts: () => void;
  setXhsCommanderAlertDismissHandler: (handler: ((alertId: string) => void | Promise<void>) | null) => void;
  setXhsCommanderAlertRestoreHandler: (handler: (() => void | Promise<void>) | null) => void;
};

const AlertCenterContext = createContext<AlertCenterValue | null>(null);
const DISMISSED_XHS_COMMANDER_ALERTS_KEY = 'openclaw.dismissedXhsCommanderAlerts.v1';

function readDismissedCommanderAlerts(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DISMISSED_XHS_COMMANDER_ALERTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeDismissedCommanderAlerts(ids: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISMISSED_XHS_COMMANDER_ALERTS_KEY, JSON.stringify(ids.slice(-200)));
  } catch {
    // Ignore storage failures; alerts should still work for the current session.
  }
}

export function AlertCenterProvider({ children }: { children: React.ReactNode }) {
  const [interventionAlerts, setInterventionAlerts] = useState<InterventionAlert[]>([]);
  const [rawXhsCommanderAlerts, setRawXhsCommanderAlerts] = useState<XhsCommanderAlert[]>([]);
  const [dismissedXhsCommanderAlertIds, setDismissedXhsCommanderAlertIds] = useState<string[]>([]);
  const dismissHandlerRef = useRef<((alertId: string) => void | Promise<void>) | null>(null);
  const restoreHandlerRef = useRef<(() => void | Promise<void>) | null>(null);

  useEffect(() => {
    setDismissedXhsCommanderAlertIds(readDismissedCommanderAlerts());
  }, []);

  const setAlerts = useCallback((alerts: InterventionAlert[]) => {
    setInterventionAlerts(alerts);
  }, []);

  const setCommanderAlerts = useCallback((alerts: XhsCommanderAlert[]) => {
    setRawXhsCommanderAlerts(alerts);
  }, []);

  const syncDismissedXhsCommanderAlerts = useCallback((ids: string[]) => {
    const normalized = Array.from(new Set((ids ?? []).map((item) => String(item)).filter(Boolean)));
    setDismissedXhsCommanderAlertIds(normalized);
    writeDismissedCommanderAlerts(normalized);
  }, []);

  const dismissXhsCommanderAlert = useCallback((alertId: string) => {
    setDismissedXhsCommanderAlertIds((current) => {
      const next = Array.from(new Set([...current, String(alertId)].filter(Boolean)));
      writeDismissedCommanderAlerts(next);
      return next;
    });
    dismissHandlerRef.current?.(alertId);
  }, []);

  const clearDismissedXhsCommanderAlerts = useCallback(() => {
    setDismissedXhsCommanderAlertIds([]);
    writeDismissedCommanderAlerts([]);
    restoreHandlerRef.current?.();
  }, []);

  const setXhsCommanderAlertDismissHandler = useCallback((handler: ((alertId: string) => void | Promise<void>) | null) => {
    dismissHandlerRef.current = handler;
  }, []);

  const setXhsCommanderAlertRestoreHandler = useCallback((handler: (() => void | Promise<void>) | null) => {
    restoreHandlerRef.current = handler;
  }, []);

  const xhsCommanderAlerts = useMemo(() => {
    const dismissed = new Set(dismissedXhsCommanderAlertIds);
    return rawXhsCommanderAlerts.filter((alert) => !dismissed.has(alert.id));
  }, [dismissedXhsCommanderAlertIds, rawXhsCommanderAlerts]);

  return (
    <AlertCenterContext.Provider
      value={{
        interventionAlerts,
        setInterventionAlerts: setAlerts,
        xhsCommanderAlerts,
        setXhsCommanderAlerts: setCommanderAlerts,
        syncDismissedXhsCommanderAlerts,
        dismissXhsCommanderAlert,
        clearDismissedXhsCommanderAlerts,
        setXhsCommanderAlertDismissHandler,
        setXhsCommanderAlertRestoreHandler,
      }}
    >
      {children}
    </AlertCenterContext.Provider>
  );
}

export function useAlertCenter() {
  const ctx = useContext(AlertCenterContext);
  if (!ctx) {
    return {
      interventionAlerts: [] as InterventionAlert[],
      setInterventionAlerts: () => {},
      xhsCommanderAlerts: [] as XhsCommanderAlert[],
      setXhsCommanderAlerts: () => {},
      syncDismissedXhsCommanderAlerts: () => {},
      dismissXhsCommanderAlert: () => {},
      clearDismissedXhsCommanderAlerts: () => {},
      setXhsCommanderAlertDismissHandler: () => {},
      setXhsCommanderAlertRestoreHandler: () => {},
    };
  }
  return ctx;
}
