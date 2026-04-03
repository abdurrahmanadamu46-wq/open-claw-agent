'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  fetchScopeAlertFeed,
  resolveScopeAlertEventsUrl,
  type ScopeAlertFeedItem,
  type ScopeAlertFeedResponse,
} from '@/services/endpoints/agent-dashboard';

interface ScopeAlertSnapshotMessage {
  type: 'scope_alert_snapshot';
  data: ScopeAlertFeedResponse;
}

export function useScopeAlertFeed() {
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [liveItems, setLiveItems] = useState<ScopeAlertFeedItem[] | null>(null);

  const query = useQuery({
    queryKey: ['agent', 'scope-alert-feed'],
    queryFn: fetchScopeAlertFeed,
    refetchInterval: 30000,
  });

  useEffect(() => {
    const wsUrl = resolveScopeAlertEventsUrl();
    if (!wsUrl) {
      return;
    }

    let socket: WebSocket | null = null;

    try {
      socket = new WebSocket(wsUrl);
      socket.onopen = () => {
        setStreamConnected(true);
        setStreamError(null);
      };
      socket.onerror = () => {
        setStreamError('scope-alert-stream-error');
      };
      socket.onclose = () => {
        setStreamConnected(false);
      };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as ScopeAlertSnapshotMessage;
          if (payload.type === 'scope_alert_snapshot' && payload.data?.items) {
            setLiveItems(payload.data.items);
          }
        } catch {
          setStreamError('scope-alert-stream-parse-error');
        }
      };
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : 'scope-alert-stream-init-failed');
    }

    return () => {
      socket?.close();
      setStreamConnected(false);
    };
  }, []);

  const items = useMemo(
    () => liveItems ?? query.data?.items ?? [],
    [liveItems, query.data?.items],
  );

  return {
    items,
    total: liveItems?.length ?? query.data?.total ?? 0,
    streamConnected,
    streamError,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
