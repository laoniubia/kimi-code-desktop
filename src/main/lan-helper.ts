import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';

export interface LanInterface {
  name: string;
  ip: string;
  isPreferred: boolean;
}

export interface RemoteAccessInfo {
  lanIp: string;
  port: number;
  url: string;
  qrCodeDataUrl: string;
  token?: string;
  availableIps: LanInterface[];
}

/**
 * 虚拟网卡与隧道名称黑名单（防止 VPN、代理或容器网卡污染扫码地址）
 */
const VIRTUAL_INTERFACE_PATTERNS = [
  /^utun/i,
  /^tun/i,
  /^tap/i,
  /^ppp/i,
  /^awdl/i, // Apple Wireless Direct Link
  /^llw/i,
  /^bridge/i,
  /^docker/i,
  /^vbox/i,
  /^vmnet/i,
  /vethernet/i,
  /hyper-v/i,
  /wsl/i,
  /virtual/i,
  /vmware/i,
  /vbox/i,
  /tailscale/i,
  /zerotier/i,
  /tap/i,
  /tun/i,
  /loopback/i,
];

/**
 * 常见代理虚拟网段（如 Clash/Surge 默认的 198.18.0.0/15）
 */
function isVirtualSubnet(ip: string): boolean {
  if (ip.startsWith('198.18.') || ip.startsWith('198.19.')) return true;
  if (ip.startsWith('169.254.')) return true; // Link-local
  return false;
}

/**
 * 获取所有真实可用的物理局域网网络接口
 */
export function getAvailableLanInterfaces(): LanInterface[] {
  const interfaces = networkInterfaces();
  const list: { name: string; ip: string; priority: number }[] = [];

  for (const [name, nets] of Object.entries(interfaces)) {
    if (!nets) continue;

    // 过滤虚拟网卡
    if (VIRTUAL_INTERFACE_PATTERNS.some((p) => p.test(name))) {
      continue;
    }

    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal && !isVirtualSubnet(net.address)) {
        const ip = net.address;
        let priority = 1;

        // 家庭/公司常见路由器私网段
        if (ip.startsWith('192.168.')) priority = 10;
        else if (ip.startsWith('10.')) priority = 8;
        else if (ip.startsWith('172.')) priority = 7;

        // macOS 默认 Wi-Fi 通常为 en0
        if (name === 'en0') priority += 5;

        // Windows 常见物理网卡名称加权优先
        if (
          /wlan/i.test(name) ||
          /wi-fi/i.test(name) ||
          /以太网/i.test(name) ||
          /ethernet/i.test(name)
        ) {
          priority += 5;
        }

        list.push({ name, ip, priority });
      }
    }
  }

  list.sort((a, b) => b.priority - a.priority);

  return list.map((item, idx) => ({
    name: item.name,
    ip: item.ip,
    isPreferred: idx === 0,
  }));
}

/**
 * 获取本机首选局域网 IPv4 地址
 */
export function getLocalLanIp(): string {
  const list = getAvailableLanInterfaces();
  return list.length > 0 ? list[0].ip : '127.0.0.1';
}

/**
 * 构造手机扫码打开的 URL，并生成高清 DataURL 二维码
 */
export async function generateRemoteAccessInfo(options: {
  port: number;
  token?: string;
  sessionId?: string;
  lanIpOverride?: string;
}): Promise<RemoteAccessInfo> {
  const availableIps = getAvailableLanInterfaces();
  const lanIp = options.lanIpOverride || (availableIps.length > 0 ? availableIps[0].ip : '127.0.0.1');
  const { port, token, sessionId } = options;

  let url = `http://${lanIp}:${port}`;
  if (sessionId) {
    url += `/sessions/${encodeURIComponent(sessionId)}`;
  } else {
    url += '/';
  }

  // 携带 #token hash，浏览器加载后由客户端读取免密登录，hash 不会被服务端日志记录
  if (token) {
    url += `#token=${token}`;
  }

  const qrCodeDataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'L', // 7% 纠错率，点阵更大更稀疏，手机摄像头 0.1 秒极速对焦与解码
    margin: 4, // 官方标准 4 模块 Quiet Zone 白边，防止深色背景干扰相机识别
    width: 280, // 280px 超清点阵
    color: {
      dark: '#000000', // 100% 纯黑
      light: '#ffffff', // 100% 纯白
    },
  });

  return {
    lanIp,
    port,
    url,
    qrCodeDataUrl,
    token,
    availableIps,
  };
}
