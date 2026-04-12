/**
 * ClawCommerce Agent - Dashboard API for nodes status
 * GET /api/agent/nodes/status + WebSocket real-time push via onEvent.
 * Backend mounts the handler and forwards NodeManager.onEvent to WebSocket.
 * @module agent/dashboard-api
 */
/**
 * Returns a handler for GET /api/agent/nodes/status.
 * Backend usage: app.get('/api/agent/nodes/status', getNodesStatusHandler(nodeManager))
 */
export function getNodesStatusHandler(nodeManager) {
    return async (_req, res) => {
        try {
            const data = await nodeManager.getNodesStatus();
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify(data));
        }
        catch (err) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Failed to get nodes status', message: err.message }));
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
//# sourceMappingURL=dashboard-api.js.map