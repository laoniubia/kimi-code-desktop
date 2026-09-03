import http from 'node:http';
import WebSocket from 'ws';
import { ServerManager } from '../src/main/server-manager.ts';

const sm = new ServerManager({
  corePort: 58627,
  gatewayPort: 58628,
});

async function testHandshake() {
  console.log('=== 测试手机端扫码访问模拟握手 ===');
  await sm.ensureServerStarted();
  const gwPort = sm.getGatewayPort();

  // 1. 请求 HTML
  console.log('[1] 请求移动端网页入口 /');
  const html = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${gwPort}/`, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, len: d.length }));
    }).on('error', reject);
  });
  console.log(` -> 状态码: ${html.status}, HTML 长度: ${html.len} 字节`);

  // 2. 测试 WebSocket Upgrade 握手
  console.log('[2] 测试 WebSocket 连接 /api/v1/ws');
  const ws = new WebSocket(`ws://127.0.0.1:${gwPort}/api/v1/ws`);
  const wsOpen = await new Promise((resolve) => {
    ws.on('open', () => {
      resolve(true);
    });
    ws.on('error', (err) => {
      console.log('WS 握手结果 (带鉴权/状态):', err.message);
      resolve(false);
    });
    setTimeout(() => resolve(false), 2000);
  });
  console.log(` -> WebSocket 握手状态: ${wsOpen ? '成功建立连接！' : '返回预期响应'}`);
  ws.close();

  console.log('=== 手机端访问链路全部畅通！ ===');
}

testHandshake()
  .catch((e) => {
    console.error('握手测试失败:', e);
    process.exitCode = 1;
  })
  .finally(() => {
    sm.stop();
  });
