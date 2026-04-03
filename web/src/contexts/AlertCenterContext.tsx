'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

/** 单条风控熔断告警（用于异常告警中心展示） */
export interface InterventionAlert {
  nodeId: string;
  clientName: string;
  reason?: string;
}

type AlertCenterValue = {
  interventionAlerts: InterventionAlert[];
  setInterventionAlerts: (alerts: InterventionAlert[]) => void;
};

const AlertCenterContext = createContext<AlertCenterValue | null>(null);

export function AlertCenterProvider({ children }: { children: React.ReactNode }) {
  const [interventionAlerts, setInterventionAlerts] = useState<InterventionAlert[]>([]);

  const setAlerts = useCallback((alerts: InterventionAlert[]) => {
    setInterventionAlerts(alerts);
  }, []);

  return (
    <AlertCenterContext.Provider value={{ interventionAlerts, setInterventionAlerts: setAlerts }}>
      {children}
    </AlertCenterContext.Provider>
  );
}

export function useAlertCenter() {
  const ctx = useContext(AlertCenterContext);
  if (!ctx) return { interventionAlerts: [] as InterventionAlert[], setInterventionAlerts: () => {} };
  return ctx;
}
