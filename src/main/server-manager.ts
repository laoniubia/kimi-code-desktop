import { spawn, ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, openSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { findNodeExecutable, findKimiCli } from './env-helper';

export interface ServerManagerConfig {
  corePort: number;       // kap-server 核心端口 (默认 58627)
  gatewayPort: number;    // 局域网网关端口 (默认 58628，供手机直接访问)
  repoRoot?: string;      // kimi-code 仓库根路径
}

export class ServerManager {
  private config: ServerManagerConfig;
  private childProcess: ChildProcess | null = null;
  private gatewayServer: http.Server | null = null;
  private token: string = '';
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private isSpawning: boolean = false;

  constructor(config?: Partial<ServerManagerConfig>) {
    this.config = {
      corePort: config?.corePort ?? 58627,
      gatewayPort: config?.gatewayPort ?? 58628,
      repoRoot: config?.repoRoot ?? process.env.KIMI_REPO_ROOT ?? undefined,
    };
  }

  public getToken(): string {
    if (this.token) return this.token;
    try {
      const tokenPath = join(homedir(), '.kimi-code', 'server.token');
      if (existsSync(tokenPath)) {
        this.token = readFileSync(tokenPath, 'utf8').trim();
      }
    } catch {
      // ignore
    }
    return this.token;
  }

  public getGatewayPort(): number {
    return this.config.gatewayPort;
  }

  public getCorePort(): number {
    return this.config.corePort;
  }

  /**
   * 检查 corePort 是否已经有存活的 kap-server
   */
  public async isCoreRunning(): Promise<boolean> {
    const token = this.getToken();
    return new Promise((resolve) => {
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const req = http.get(
        `http://127.0.0.1:${this.config.corePort}/api/v1/meta`,
        { headers, timeout: 2000 },
        (res) => {
          // 只要有 HTTP 响应码（200、401、403、429 等），都证明该端口上的 HTTP 服务健康存活
          resolve(res.statusCode !== undefined);
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * 启动完全脱离终端会话组的系统级独立守护进程
   */
  public async spawnDaemon(): Promise<void> {
    if (this.isSpawning) return;
    this.isSpawning = true;

    try {
      console.log(`[ServerManager] 正在启动系统级脱离终端的独立守护进程...`);
      const nodeBin = findNodeExecutable();
      const kimiCli = findKimiCli(this.config.repoRoot);
      console.log(`[ServerManager] 探测到 Node 解释器: ${nodeBin}, Kimi 入口: ${kimiCli.execPath}`);

      let execCmd = nodeBin;
      let execArgs: string[] = [];

      if (kimiCli.isDirectScript) {
        // 直接使用 node 解释执行 kimi 入口脚本，彻底规避任何 /usr/bin/env 寻址失败与终端环境差异！
        execCmd = nodeBin;
        execArgs = [
          kimiCli.execPath,
          'web',
          '--host', '0.0.0.0',
          '--port', String(this.config.corePort),
          '--no-open',
          '--insecure-no-tls',
          '--allowed-host', '*',
        ];
      } else {
        execCmd = kimiCli.execPath;
        execArgs = [
          'web',
          '--host', '0.0.0.0',
          '--port', String(this.config.corePort),
          '--no-open',
          '--insecure-no-tls',
          '--allowed-host', '*',
        ];
      }

      // 准备独立日志文件
      const logDir = join(homedir(), '.kimi-code', 'logs');
      mkdirSync(logDir, { recursive: true });
      const logFile = join(logDir, 'desktop-daemon.log');
      const outFd = openSync(logFile, 'a');

      // 核心工程实现：使用 detached: true 和 stdio 文件流，彻底断开与终端 TTY 的关联！
      const child = spawn(execCmd, execArgs, {
        cwd: homedir(),
        detached: true,
        stdio: ['ignore', outFd, outFd],
        env: {
          ...process.env,
        },
      });

      child.unref();
      this.childProcess = child;

      // 轮询等待核心服务启动就绪
      let ready = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 600));
        if (await this.isCoreRunning()) {
          ready = true;
          break;
        }
      }

      if (!ready) {
        console.error('[ServerManager] 守护进程启动超时，查看日志:', logFile);
      } else {
        console.log('[ServerManager] 守护进程已成功在后台独立运行！');
      }
    } finally {
      this.isSpawning = false;
    }
  }

  /**
   * 启动后台守护进程看门狗（Watchdog & Auto-Heal）
   * 稳健巡检，在核心服务意外崩溃时自动拉起独立后台守护进程
   */
  public startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(async () => {
      const alive = await this.isCoreRunning();
      if (!alive && !this.isSpawning) {
        console.warn('[ServerManager] [Watchdog] 检测到核心服务离线，立即自愈重启...');
        await this.spawnDaemon();
      }
    }, 5000);
  }

  /**
   * 启动本地服务端（若已在运行则复用并挂载看门狗）
   */
  public async ensureServerStarted(): Promise<void> {
    const running = await this.isCoreRunning();
    if (running) {
      console.log(`[ServerManager] 发现已在运行的 Kimi 后台服务 (端口 ${this.config.corePort})`);
    } else {
      await this.spawnDaemon();
    }

    this.getToken();
    await this.startGateway();
    this.startWatchdog();
  }

  /**
   * 启动智能局域网网关（解决手机扫码访问时的跨域、Host/DNS-rebinding，纯透明代理）
   */
  public async startGateway(): Promise<number> {
    if (this.gatewayServer) return this.config.gatewayPort;

    const targetHost = '127.0.0.1';
    const targetPort = this.config.corePort;

    const server = http.createServer((req, res) => {
      const headers = { ...req.headers };
      headers.host = `${targetHost}:${targetPort}`;
      if (headers.origin) {
        headers.origin = `http://${targetHost}:${targetPort}`;
      }

      // 全部请求纯透明代理，坚决不进行任何 HTML/JS 篡改，杜绝重定向死循环
      const proxyReq = http.request(
        {
          host: targetHost,
          port: targetPort,
          path: req.url,
          method: req.method,
          headers,
        },
        (proxyRes) => {
          const resHeaders = { ...proxyRes.headers };
          // 静态资产注入强缓存头
          if (
            req.url &&
            (req.url.startsWith('/assets/') ||
              req.url.endsWith('.js') ||
              req.url.endsWith('.css') ||
              req.url.endsWith('.wasm') ||
              req.url.endsWith('.png') ||
              req.url.endsWith('.ico'))
          ) {
            resHeaders['cache-control'] = 'public, max-age=31536000, immutable';
          }
          res.writeHead(proxyRes.statusCode || 200, resHeaders);
          proxyRes.pipe(res);
        },
      );

      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
        }
        res.end('Bad Gateway: ' + err.message);
      });

      req.pipe(proxyReq);
    });

    // 转发 WebSocket Upgrade 隧道（手机端流式打字、交互同步的核心）
    server.on('upgrade', (req, clientSocket, head) => {
      const targetSocket = net.connect(targetPort, targetHost, () => {
        let rawHeaders = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const key = req.rawHeaders[i];
          let val = req.rawHeaders[i + 1];
          if (key.toLowerCase() === 'host') {
            val = `${targetHost}:${targetPort}`;
          } else if (key.toLowerCase() === 'origin') {
            val = `http://${targetHost}:${targetPort}`;
          }
          rawHeaders += `${key}: ${val}\r\n`;
        }
        rawHeaders += '\r\n';

        targetSocket.write(rawHeaders);
        if (head && head.length > 0) {
          targetSocket.write(head);
        }
        targetSocket.pipe(clientSocket);
        clientSocket.pipe(targetSocket);
      });

      targetSocket.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => targetSocket.destroy());
    });

    return new Promise((resolve, reject) => {
      const tryListen = (port: number) => {
        server.listen(port, '0.0.0.0', () => {
          this.config.gatewayPort = port;
          console.log(
            `[ServerManager] 局域网协同网关已就绪: 0.0.0.0:${port} -> ${targetHost}:${targetPort}`,
          );
          resolve(port);
        });
      };

      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(
            `[ServerManager] 端口 ${this.config.gatewayPort} 被占用，自动尝试端口 ${this.config.gatewayPort + 1}...`,
          );
          this.config.gatewayPort += 1;
          tryListen(this.config.gatewayPort);
        } else {
          console.error('[ServerManager] 网关服务错误:', err);
          reject(err);
        }
      });

      tryListen(this.config.gatewayPort);
      this.gatewayServer = server;
    });
  }

  public stop(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.gatewayServer) {
      this.gatewayServer.close();
      this.gatewayServer = null;
    }
  }
}
