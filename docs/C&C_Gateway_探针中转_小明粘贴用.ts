/**
 * 【选项 A】AgentCCGateway — 探针透明中转（小明粘贴到 Nest 工程）
 *
 * 原则：不解析、不落库图片，只做房间 Relay，零 CPU。
 * Agent emit probe.stream → 本网关 → frontend_tenant_${tenantId} emit probe.render
 *
 * 前端 useDeviceProbe 已按 payload.deviceId（或 machineCode）过滤。
 */

// @SubscribeMessage('probe.stream')
// handleProbeStream(@ConnectedSocket() client: Socket, @MessageBody() payload: { machineCode?: string; image?: string }) {
//   const { tenantId, machineCode } = client.data as { tenantId: string; machineCode: string };
//   const deviceId = payload.machineCode ?? machineCode;
//   if (!payload?.image) return;
//   this.server.to(`frontend_tenant_${tenantId}`).emit('probe.render', {
//     deviceId,
//     machineCode: deviceId,
//     image: payload.image, // 已是 data:image/jpeg;base64,... 或纯 base64 均可
//   });
// }

/**
 * 前端大盘要收到 probe.render，浏览器必须先以「商家 JWT」连同一 Gateway，
 * 并在 handleConnection 里 join frontend_tenant_${tenantId}（与 Agent 房间分离，避免 Agent 收到自己的图）。
 *
 * 示例：
 *   client.join(`frontend_tenant_${tenantId}`); // 仅 Dashboard 连接走这条
 */

export {};
