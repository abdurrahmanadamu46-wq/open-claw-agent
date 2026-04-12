/**
 * ClawCommerce Agent - Dashboard API for nodes status
 * GET /api/agent/nodes/status + WebSocket real-time push via onEvent.
 * Backend mounts the handler and forwards NodeManager.onEvent to WebSocket.
 * @module agent/dashboard-api
 */
import type { NodeManager } from './node-manager.js';
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
export declare function getNodesStatusHandler(nodeManager: NodeManager): (_req: IncomingMessage, res: ServerResponse) => Promise<void>;
/**
 * WebSocket real-time push: when creating NodeManager, pass
 *   onEvent: (event) => { yourWsServer.broadcast(JSON.stringify(event)) }
 * so that all node_allocated | node_released | node_unhealthy | node_recovered | node_heartbeat
 * events are pushed to connected dashboard clients.
 */
export declare const WS_PUSH_DOC = "\nWebSocket: Pass onEvent when constructing NodeManager:\n  const nodeManager = new NodeManager({\n    ...\n    onEvent: (event) => {\n      wss.clients.forEach((ws) => {\n        if (ws.readyState === 1) ws.send(JSON.stringify(event));\n      });\n    },\n  });\nThen GET /api/agent/nodes/status for full snapshot; WS for live updates.\n";
//# sourceMappingURL=dashboard-api.d.ts.map