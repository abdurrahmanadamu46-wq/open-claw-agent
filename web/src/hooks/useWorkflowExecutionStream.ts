'use client';

import { useEffect, useState } from 'react';
import api from '@/services/api';
import type { WorkflowExecutionStreamEvent } from '@/types/workflow-engine';

export function useWorkflowExecutionStream(executionId: string | null | undefined) {
  const [events, setEvents] = useState<WorkflowExecutionStreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    if (!executionId) {
      setEvents([]);
      setConnected(false);
      setErrorText('');
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const token = typeof window !== 'undefined' ? localStorage.getItem('clawcommerce_token') : null;
    const resolvedExecutionId = String(executionId);

    async function run() {
      try {
        const response = await fetch(
          `${api.defaults.baseURL || ''}/api/v1/workflows/executions/${encodeURIComponent(resolvedExecutionId)}/stream`,
          {
            method: 'GET',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: controller.signal,
          },
        );
        if (!response.ok || !response.body) {
          throw new Error(`stream_failed_${response.status}`);
        }

        setEvents([]);
        setConnected(true);
        setErrorText('');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          while (buffer.includes('\n\n')) {
            const boundary = buffer.indexOf('\n\n');
            const chunk = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const dataLine = chunk
              .split('\n')
              .find((line) => line.startsWith('data:'));
            if (!dataLine) continue;
            const payload = dataLine.slice(5).trim();
            if (!payload) continue;
            const event = JSON.parse(payload) as WorkflowExecutionStreamEvent;
            if (event.type === 'heartbeat') continue;
            setEvents((prev) => [...prev, event]);
            if (event.type === 'execution_completed' || event.type === 'execution_failed' || event.type === 'execution_cancelled') {
              setConnected(false);
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'stream_failed';
        if (!cancelled && message !== 'The operation was aborted.') {
          setErrorText(message);
          setConnected(false);
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [executionId]);

  return { events, connected, errorText };
}
