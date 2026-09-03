import { ServerManager } from '../src/main/server-manager.ts';
import { generateRemoteAccessInfo, getLocalLanIp } from '../src/main/lan-helper.ts';
import http from 'node:http';

const sm = new ServerManager({
  corePort: 58627,
  gatewayPort: 58628,
});

// 信号处理：Ctrl+C / kill 时确保释放端口
process.on('SIGINT', () => {
  console.log('\n[test] 收到 SIGINT，正在清理...');
  sm.stop();
  process.exit(130);
});
process.on('SIGTERM', () => {
  console.log('\n[test] 收到 SIGTERM，正在清理...');
  sm.stop();
  process.exit(143);
});

async function main() {
  console.log('=== 开始测试桌面端后台服务与局域网网关 ===');

  const lanIp = getLocalLanIp();
  console.log(`[1] 探测到本机局域网 IPv4: ${lanIp}`);

  console.log('[2] 启动/检查服务...');
  await sm.ensureServerStarted();

  const token = sm.getToken();
  console.log(`[3] 获取到服务器 Token: ${token ? token.slice(0, 8) + '...' : '(空)'}`);

  const accessInfo = await generateRemoteAccessInfo({
    port: sm.getGatewayPort(),
    token,
  });
  console.log(`[4] 生成扫码 URL: ${accessInfo.url}`);
  console.log(`[5] 二维码 DataURL 长度: ${accessInfo.qrCodeDataUrl.length} 字符`);

  // 测试请求网关代理的 /api/v1/meta（该路由受 Bearer token 保护，携带 [3] 步获取的 token 才能得到 2xx）
  const gwPort = sm.getGatewayPort();
  console.log(`[6] 测试局域网网关 HTTP 代理 (端口 ${gwPort})...`);
  const testReq = await new Promise((resolve, reject) => {
    http.get(
      `http://127.0.0.1:${gwPort}/api/v1/meta`,
      { headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      },
    ).on('error', reject);
  });
  console.log(`[7] 网关代理 /api/v1/meta 响应码: ${testReq.status}`);

  // 断言：响应码非 2xx 或关键信息为空均记为失败，统一走末尾失败分支
  const failures = [];
  if (!(testReq.status >= 200 && testReq.status <= 299)) {
    failures.push(`网关代理 /api/v1/meta 响应码非 2xx: ${testReq.status}`);
  }
  if (typeof accessInfo.url !== 'string' || accessInfo.url.length === 0) {
    failures.push('accessInfo.url 应为非空字符串');
  }
  if (typeof accessInfo.qrCodeDataUrl !== 'string' || accessInfo.qrCodeDataUrl.length === 0) {
    failures.push('accessInfo.qrCodeDataUrl 应为非空字符串');
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error('断言失败:', failure);
    }
    process.exitCode = 1;
    return;
  }

  console.log('=== 测试顺利完成！服务已准备就绪 ===');
}

main()
  .then(() => {
    // 断言失败时 main 内已设置非零退出码，仅在成功时补 0
    process.exitCode = process.exitCode ?? 0;
  })
  .catch((err) => {
    console.error('测试异常:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    sm.stop();
  });
