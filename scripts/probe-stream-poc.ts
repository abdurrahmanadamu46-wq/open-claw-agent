/**
 * 【选项 B】Agent 侧 probe.stream 发送端 — 1fps JPEG，不抢抓取算力
 *
 * 无 Playwright 时：发 1x1 或极小 JPEG base64，验证网关 Relay + 前端 Modal。
 * 有 Playwright 后：把 sendFrame 换成 page.screenshot({ type: 'jpeg', quality: 30 })。
 *
 * 运行：
 *   npm run poc:probe-stream
 * 环境：
 *   C_AND_C_SERVER_URL  MOCK_JWT_TOKEN  MACHINE_CODE（与 lobster-client-poc 一致）
 */
import { io, type Socket } from 'socket.io-client';

const URL = process.env.C_AND_C_SERVER_URL ?? 'http://localhost:3000/agent-cc';
const TOKEN = process.env.MOCK_JWT_TOKEN ?? '';
const MACHINE_CODE = process.env.MACHINE_CODE ?? 'MAC-POC-LOBSTER-001';

// 极小 JPEG base64（约 100B 级），避免占带宽；联调通过后换 Playwright 截图
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';

function dataUrlJpeg(base64: string): string {
  if (base64.startsWith('data:')) return base64;
  return `data:image/jpeg;base64,${base64}`;
}

async function main() {
  const socket: Socket = io(URL, {
    auth: { token: TOKEN || 'placeholder' },
    extraHeaders: { 'x-machine-code': MACHINE_CODE },
    transports: ['websocket'],
    reconnection: true,
  });

  socket.on('connect', () => {
    console.log('[probe-poc] connected', socket.id);
  });
  socket.on('connect_error', (e) => console.error('[probe-poc] connect_error', e.message));
  socket.on('server.system.ready', () => console.log('[probe-poc] system.ready'));
  socket.on('system.ready', () => console.log('[probe-poc] system.ready (compat)'));

  // 收到 probe.start 再推流；若后端未实现，则 3s 后自动开始推，便于联调
  let probing = false;
  socket.on('probe.start', () => {
    console.log('[probe-poc] probe.start');
    probing = true;
  });
  socket.on('probe.stop', () => {
    console.log('[probe-poc] probe.stop');
    probing = false;
  });

  const sendFrame = () => {
    if (!socket.connected) return;
    socket.emit('probe.stream', {
      machineCode: MACHINE_CODE,
      image: dataUrlJpeg(TINY_JPEG_BASE64),
    });
    console.log('[probe-poc] probe.stream emitted');
  };

  setTimeout(() => {
    if (!probing) {
      console.log('[probe-poc] no probe.start from server, auto-start push 1fps for relay test');
      probing = true;
    }
  }, 3000);

  setInterval(() => {
    if (probing) sendFrame();
  }, 1000);

  // Playwright 替换示例（安装 playwright 后取消注释）：
  // import { chromium } from 'playwright';
  // const browser = await chromium.launch();
  // const page = await browser.newPage();
  // await page.goto('https://example.com');
  // setInterval(async () => {
  //   if (!probing) return;
  //   const buf = await page.screenshot({ type: 'jpeg', quality: 30 });
  //   socket.emit('probe.stream', { machineCode: MACHINE_CODE, image: dataUrlJpeg(buf.toString('base64')) });
  // }, 1000);
}

main().catch(console.error);
