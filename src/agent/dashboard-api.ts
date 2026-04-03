/**
 * ClawCommerce Agent - Dashboard API for nodes status
 * GET /api/agent/nodes/status + WebSocket real-time push via onEvent.
 * Backend mounts the handler and forwards NodeManager.onEvent to WebSocket.
 * @module agent/dashboard-api
 */

import type { NodeManager } from './node-manager.js';
import type { NodesStatusResponse } from './types.js';

/** Request-like (Express/Connect compatible) */
export interface IncomingMessage {
  method?: string;
  url?: string;
}

/** Response-like (Express/Connect compatible) */
export interface ServerResponse {
  setHeader(name: string, value: string | number): void;
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: string): void;
  statusCode?: number;
}

/**
 * Returns a handler for GET /api/agent/nodes/status.
 * Backend usage: app.get('/api/agent/nodes/status', getNodesStatusHandler(nodeManager))
 */
export function getNodesStatusHandler(nodeManager: NodeManager) {
  return async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const data: NodesStatusResponse = await nodeManager.getNodesStatus();
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } catch (err) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to get nodes status', message: (err as Error).message }));
    }
  };
}

/**
 * WebSocket real-time push: when creating NodeManager, pass
 *   onEvent: (event) => { yourWsServer.broadcast(JSON.stringify(event)) }
 * so that all node_allocated | node_released | node_unhealthy | node_recovered | node_heartbeat
 * events are pushed to connected dashboard clients.
 */
export const WS_PUSH_DOC = `
WebSocket: Pass onEvent when constructing NodeManager:
  const nodeManager = new NodeManager({
    ...
    onEvent: (event) => {
      wss.clients.forEach((ws) => {
        if (ws.readyState === 1) ws.send(JSON.stringify(event));
      });
    },
  });
Then GET /api/agent/nodes/status for full snapshot; WS for live updates.
`;
