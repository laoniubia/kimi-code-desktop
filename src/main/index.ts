import {
  app,
  BrowserWindow,
  ipcMain,
  clipboard,
  shell,
  nativeTheme,
  Menu,
  MenuItemConstructorOptions,
  Tray,
  nativeImage,
  dialog,
} from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fixEnvironment } from './env-helper';
import { ServerManager } from './server-manager';
import {
  generateRemoteAccessInfo,
  getLocalLanIp,
  getAvailableLanInterfaces,
} from './lan-helper';

// ---------------------------------------------------------------------------
// 必须最优先执行：初始化与修复 macOS GUI 环境下的 PATH 及系统环境变量
// ---------------------------------------------------------------------------
fixEnvironment();

// ---------------------------------------------------------------------------
// 异常捕获与后台守护机制
// ---------------------------------------------------------------------------
process.on('uncaughtException', (error) => {
  console.error('[Main] uncaughtException:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] unhandledRejection:', reason);
});

// ---------------------------------------------------------------------------
// 单实例互斥锁
// ---------------------------------------------------------------------------
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// Chromium 底层硬件加速与持久化本地磁盘缓存策略
// ---------------------------------------------------------------------------
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disk-cache-size', '524288000'); // 500MB 本地磁盘缓存
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096'); // 限制与优化 V8 堆内存

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let remoteModalWindow: BrowserWindow | null = null;

const serverManager = new ServerManager({
  corePort: 58627,
  gatewayPort: 58628,
});

/**
 * 弹出高清晰度、100% 易识别的原生手机扫码模态窗口
 */
async function showRemoteModal() {
  if (remoteModalWindow && !remoteModalWindow.isDestroyed()) {
    remoteModalWindow.show();
    remoteModalWindow.focus();
    return;
  }

  const token = serverManager.getToken();
  const info = await generateRemoteAccessInfo({
    port: serverManager.getGatewayPort(),
    token,
  });

  remoteModalWindow = new BrowserWindow({
    width: 360,
    height: 520,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: '手机扫码控制',
    parent: mainWindow ?? undefined,
    modal: false,
    show: true,
    backgroundColor: '#18181b',
    titleBarStyle: 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  remoteModalWindow.on('closed', () => {
    remoteModalWindow = null;
  });

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>手机扫码控制</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #18181b; color: #f4f4f5; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; padding: 24px; user-select: none; }
    .header { width: 100%; display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .title { font-size: 15px; font-weight: 600; color: #fafafa; display: flex; align-items: center; gap: 8px; }
    .status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #34d399; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.25); padding: 3px 8px; border-radius: 99px; }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: #10b981; }
    .qr-box { width: 240px; height: 240px; background: #ffffff; border-radius: 12px; padding: 12px; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(0,0,0,0.5); margin-bottom: 16px; }
    .qr-box img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .hint { font-size: 12px; color: #a1a1aa; text-align: center; line-height: 1.5; margin-bottom: 12px; }
    .ip-tag { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; color: #a1a1aa; margin-bottom: 16px; background: #27272a; padding: 4px 10px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.08); }
    .btn { width: 100%; height: 38px; background: #27272a; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px; color: #f4f4f5; font-size: 13px; font-weight: 500; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.15s; }
    .btn:hover { background: #3f3f46; }
    .btn:active { transform: scale(0.98); }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">📱 手机扫码控制</div>
    <div class="status"><span class="dot"></span>局域网已就绪</div>
  </div>
  <div class="qr-box">
    <img src="${info.qrCodeDataUrl}" alt="二维码">
  </div>
  <div class="hint">请使用手机自带系统相机或微信扫描二维码</div>
  <div class="ip-tag">网络节点: ${info.lanIp}:${info.port}</div>
  <button class="btn" id="copyBtn">复制访问链接</button>
  <script>
    const url = ${JSON.stringify(info.url)};
    document.getElementById('copyBtn').onclick = () => {
      navigator.clipboard.writeText(url);
      document.getElementById('copyBtn').textContent = '已复制到剪贴板 ✓';
      setTimeout(() => { document.getElementById('copyBtn').textContent = '复制访问链接'; }, 2000);
    };
    window.onkeydown = (e) => { if (e.key === 'Escape') window.close(); };
  </script>
</body>
</html>`;

  await remoteModalWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  remoteModalWindow.show();
  remoteModalWindow.focus();
}

/**
 * 窗口状态持久化（保存与恢复位置和尺寸）
 */
function getWindowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState(): { width: number; height: number; x?: number; y?: number } {
  try {
    const p = getWindowStatePath();
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, 'utf-8'));
    }
  } catch {}
  return { width: 1320, height: 880 };
}

function saveWindowState() {
  if (!mainWindow) return;
  try {
    const bounds = mainWindow.getBounds();
    writeFileSync(getWindowStatePath(), JSON.stringify(bounds), 'utf-8');
  } catch {}
}

/**
 * 创建和更新系统状态栏/通知区托盘（System Tray）
 */
function setupTray() {
  if (tray) return;

  const isWin = process.platform === 'win32';
  let iconPath = '';

  if (isWin) {
    // Windows 下优先使用彩色应用图标或专用 tray 图标
    const winCandidates = [
      join(__dirname, '../../build/icon.png'),
      join(__dirname, '../build/icon.png'),
      join(process.cwd(), 'build/icon.png'),
      join(__dirname, '../../assets/trayTemplate.png'),
      join(process.cwd(), 'assets/trayTemplate.png'),
    ];
    for (const cand of winCandidates) {
      if (existsSync(cand)) {
        iconPath = cand;
        break;
      }
    }
  } else {
    // macOS 优先使用 template 图标
    const macCandidates = [
      join(__dirname, '../../assets/trayTemplate.png'),
      join(__dirname, '../assets/trayTemplate.png'),
      join(process.cwd(), 'assets/trayTemplate.png'),
    ];
    for (const cand of macCandidates) {
      if (existsSync(cand)) {
        iconPath = cand;
        break;
      }
    }
  }

  let icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  if (icon.isEmpty()) {
    // 保底：生成一个 16x16 的内置单色图标
    icon = nativeImage.createFromNamedImage('NSActionTemplate', [16, 16]);
  }
  if (!isWin) {
    icon.setTemplateImage(true); // macOS 自动根据系统深浅色切换黑白显示
  }

  tray = new Tray(icon);
  tray.setToolTip('Kimi Code - 手机协同就绪');

  updateTrayMenu();

  // 点击托盘图标直接唤出/隐藏主窗口
  tray.on('click', () => {
    if (!mainWindow) {
      createWindow();
      return;
    }
    if (mainWindow.isVisible()) {
      if (mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        mainWindow.focus();
      }
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const lanIp = getLocalLanIp();
  const gwPort = serverManager.getGatewayPort();
  const token = serverManager.getToken();
  const remoteUrl = `http://${lanIp}:${gwPort}/#token=${token}`;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开 Kimi Code 主窗口',
      click: () => {
        if (!mainWindow) createWindow();
        else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '📱 手机扫码连接...',
      click: () => {
        showRemoteModal();
      },
    },
    {
      label: '复制手机访问链接',
      click: () => {
        clipboard.writeText(remoteUrl);
      },
    },
    { type: 'separator' },
    {
      label: `服务核心: 🟢 运行中 (端口: ${serverManager.getCorePort()})`,
      enabled: false,
    },
    {
      label: `局域网网关: ${lanIp}:${gwPort}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '重启后台服务',
      click: async () => {
        await serverManager.ensureServerStarted();
        updateTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: '彻底退出 Kimi Code',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

/**
 * 注册标准的 macOS / Cross-platform 原生应用菜单
 */
function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about', label: `关于 ${app.name}` },
              { type: 'separator' },
              {
                label: '偏好设置...',
                accelerator: 'CmdOrCtrl+,',
                click: () => {
                  mainWindow?.webContents.send('menu-action', 'open-settings');
                },
              },
              { type: 'separator' },
              { role: 'services', label: '服务' },
              { type: 'separator' },
              { role: 'hide', label: `隐藏 ${app.name}` },
              { role: 'hideOthers', label: '隐藏其他' },
              { role: 'unhide', label: '显示全部' },
              { type: 'separator' },
              {
                label: `退出 ${app.name}`,
                accelerator: 'Command+Q',
                click: () => {
                  isQuitting = true;
                  app.quit();
                },
              },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: '文件',
      submenu: [
        {
          label: '新建对话',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow?.webContents.send('menu-action', 'new-chat');
          },
        },
        { type: 'separator' },
        {
          label: '📱 手机扫码连接...',
          accelerator: 'CmdOrCtrl+M',
          click: () => {
            showRemoteModal();
          },
        },
        {
          label: '复制手机访问链接',
          click: async () => {
            const token = serverManager.getToken();
            const lanIp = getLocalLanIp();
            clipboard.writeText(`http://${lanIp}:${serverManager.getGatewayPort()}/#token=${token}`);
          },
        },
        { type: 'separator' },
        isMac
          ? { role: 'close', label: '关闭窗口' }
          : {
              label: '退出',
              click: () => {
                isQuitting = true;
                app.quit();
              },
            },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新载入界面' },
        { role: 'forceReload', label: '强制重新载入' },
        {
          role: 'toggleDevTools',
          label: '开发者调试工具',
          accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
        },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '进入全屏幕' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const, label: '前置所有窗口' },
            ]
          : []),
      ],
    },
    {
      role: 'help',
      label: '帮助',
      submenu: [
        {
          label: 'Kimi Code 官方文档',
          click: () => {
            shell.openExternal('https://github.com/MoonshotAI/kimi-code');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function createWindow() {
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';
  const savedState = loadWindowState();

  mainWindow = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    x: savedState.x,
    y: savedState.y,
    minWidth: 960,
    minHeight: 640,
    title: 'Kimi Code',
    show: false,
    backgroundColor: '#09090b',
    titleBarStyle: isMac ? 'hiddenInset' : (isWin ? 'hidden' : 'default'),
    titleBarOverlay: isWin
      ? {
          color: '#09090b',
          symbolColor: '#a1a1aa',
          height: 35,
        }
      : undefined,
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 记录窗口大小和位置变更
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  // 核心特性：点击红点关闭主窗口时隐藏到后台托盘常驻，确保手机端扫码连接不中断
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      return false;
    }
  });

  // 处理窗口内外部超链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 捕获并输出渲染进程控制台日志与报错
  mainWindow.webContents.on('console-message', (_, level, message, line, sourceId) => {
    console.log(`[Renderer Log L${level}] ${message} (${sourceId}:${line})`);
  });

  // 支持 F12 或 Command+Option+I 打开开发者调试工具
  mainWindow.webContents.on('before-input-event', (_, input) => {
    if (input.key === 'F12' || (input.meta && input.alt && input.key.toLowerCase() === 'i')) {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  // 渲染进程崩溃防卫与自动恢复
  mainWindow.webContents.on('render-process-gone', (_, details) => {
    console.error('[MainWindow] 渲染进程异常退出:', details);
    if (details.reason !== 'clean-exit') {
      dialog
        .showMessageBox(mainWindow!, {
          type: 'error',
          title: '渲染进程异常',
          message: '界面发生意外崩溃，是否立即重新加载？',
          buttons: ['重新加载', '退出应用'],
          defaultId: 0,
        })
        .then(({ response }) => {
          if (response === 0) mainWindow?.reload();
          else app.quit();
        });
    }
  });

  const token = serverManager.getToken();
  const targetUrl = `http://127.0.0.1:58627/?kimi_desktop=1&platform=${process.platform}${token ? `#token=${token}` : ''}`;
  console.log(`[MainWindow] 正在加载桌面控制台: ${targetUrl}`);

  await mainWindow.loadURL(targetUrl);
}

// ---------------------------------------------------------------------------
// IPC 处理器注册（规范的 Native Bridge 通道）
// ---------------------------------------------------------------------------
ipcMain.handle('get-remote-access-info', async (_, lanIpOverride?: string) => {
  const token = serverManager.getToken();
  const port = serverManager.getGatewayPort();
  return await generateRemoteAccessInfo({
    port,
    token,
    lanIpOverride,
  });
});

ipcMain.handle('get-lan-interfaces', async () => {
  return getAvailableLanInterfaces();
});

ipcMain.handle('copy-text', (_, text: string) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.on('open-external', (_, url: string) => {
  shell.openExternal(url);
});

ipcMain.on('open-remote-modal', () => {
  showRemoteModal();
});

ipcMain.on('set-theme', (_, theme: string) => {
  if (theme === 'light' || theme === 'dark' || theme === 'system') {
    nativeTheme.themeSource = theme;
  }
});

ipcMain.on('show-window', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.on('desktop-log', (_, level: string, ...args: any[]) => {
  console.log(`[Desktop Log ${level}]`, ...args);
});

ipcMain.on('set-onboarded', () => {});

ipcMain.handle('get-update-status', async () => ({ state: 'idle' }));
ipcMain.handle('check-for-updates', async () => null);
ipcMain.handle('get-update-auto-download', async () => false);
ipcMain.handle('set-update-auto-download', async () => true);
ipcMain.handle('install-update', async () => true);

// ---------------------------------------------------------------------------
// 应用生命周期
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  try {
    setupApplicationMenu();

    // 启动后台服务和局域网协同网关
    await serverManager.ensureServerStarted();
    await createWindow();
    setupTray();

    app.on('activate', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createWindow();
      }
    });
  } catch (error) {
    console.error('[App] 启动初始化失败:', error);
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  saveWindowState();
  serverManager.stop();
});
