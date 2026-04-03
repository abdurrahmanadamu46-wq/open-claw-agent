'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

/**
 * Remote device probe.
 * Consumes real relay frames only and never generates local fake probe data.
 */
export function useDeviceProbe(deviceId: string | null, enabled: boolean) {
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<{ disconnect: () => void } | null>(null);

  const applyFrame = useCallback((base64OrDataUrl: string) => {
    const src = base64OrDataUrl.startsWith('data:') ? base64OrDataUrl : `data:image/jpeg;base64,${base64OrDataUrl}`;
    setFrameSrc(src);
  }, []);

  useEffect(() => {
    if (!enabled || !deviceId) {
      setFrameSrc(null);
      setConnected(false);
      return;
    }

    const relayUrl = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_PROBE_RELAY_URL : '';
    if (!relayUrl) {
      setConnected(false);
      setFrameSrc(null);
      return;
    }

    let cancelled = false;
    import('socket.io-client')
      .then(({ io }) => {
        if (cancelled) return;
        const token = typeof localStorage !== 'undefined' ? localStorage.getItem('clawcommerce_token') : null;
        const socket = io(relayUrl, { auth: { token: token || '' }, transports: ['websocket'] });
        socketRef.current = socket;
        socket.on('probe.render', (payload: { deviceId?: string; machineCode?: string; image?: string }) => {
          const id = payload.deviceId ?? payload.machineCode;
          if (id === deviceId && payload.image) applyFrame(payload.image);
        });
        socket.on('connect', () => setConnected(true));
        socket.on('disconnect', () => setConnected(false));
      })
      .catch(() => {
        setConnected(false);
        setFrameSrc(null);
      });

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
      setFrameSrc(null);
      setConnected(false);
    };
  }, [deviceId, enabled, applyFrame]);

  return { frameSrc, connected };
}
