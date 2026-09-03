import { contextBridge, ipcRenderer } from 'electron';

// 完整补齐 Kimi Web 前端所期望的桌面端 Bridge 协议
contextBridge.exposeInMainWorld('kimiDesktop', {
  isDesktop: true,
  platform: process.platform,

  // 1. 主题同步（解决缺少 setTheme 导致历史会话抛出 TypeError 无法加载的 Bug）
  setTheme: (theme: string) => {
    try {
      ipcRenderer.send('set-theme', theme);
    } catch {}
  },

  // 2. 窗口控制
  showWindow: () => {
    try {
      ipcRenderer.send('show-window');
    } catch {}
  },

  // 3. 菜单事件监听
  onMenuAction: (callback: (action: string) => void) => {
    const handler = (_: any, action: string) => callback(action);
    ipcRenderer.on('menu-action', handler);
    return () => ipcRenderer.removeListener('menu-action', handler);
  },

  // 4. 日志桥接
  log: (level: string, ...args: any[]) => {
    try {
      ipcRenderer.send('desktop-log', level, ...args);
    } catch {}
    console.log(`[Desktop Log ${level}]`, ...args);
  },

  // 5. 新手引导状态
  setOnboarded: () => {
    try {
      ipcRenderer.send('set-onboarded');
    } catch {}
  },

  // 6. 更新机制（完整补齐更新状态与检查接口，防止抛出 TypeError）
  onUpdateStatus: (callback: (status: any) => void) => {
    const handler = (_: any, status: any) => callback(status);
    ipcRenderer.on('update-status', handler);
    try {
      ipcRenderer
        .invoke('get-update-status')
        .then((status) => {
          if (status) callback(status);
        })
        .catch(() => {
          callback({ state: 'idle' });
        });
    } catch {
      callback({ state: 'idle' });
    }
    return () => ipcRenderer.removeListener('update-status', handler);
  },
  getUpdateStatus: async () => {
    try {
      return await ipcRenderer.invoke('get-update-status');
    } catch {
      return { state: 'idle' };
    }
  },
  checkForUpdates: async () => {
    try {
      return await ipcRenderer.invoke('check-for-updates');
    } catch {}
  },
  getUpdateAutoDownload: async () => {
    try {
      return await ipcRenderer.invoke('get-update-auto-download');
    } catch {
      return false;
    }
  },
  setUpdateAutoDownload: async (autoDownload: boolean) => {
    try {
      await ipcRenderer.invoke('set-update-auto-download', autoDownload);
    } catch {}
  },
  installUpdate: async () => {
    try {
      await ipcRenderer.invoke('install-update');
    } catch {}
  },

  // 7. 本地文件路径解析
  getPathForFile: (file: any) => {
    if (file && typeof file.path === 'string') return file.path;
    return null;
  },

  // 8. 手机扫码协同专用方法
  openRemoteModal: () => {
    try {
      ipcRenderer.send('open-remote-modal');
    } catch {}
  },

  getRemoteAccessInfo: async (lanIpOverride?: string) => {
    return await ipcRenderer.invoke('get-remote-access-info', lanIpOverride);
  },

  getLanInterfaces: async () => {
    return await ipcRenderer.invoke('get-lan-interfaces');
  },

  copyText: async (text: string) => {
    return await ipcRenderer.invoke('copy-text', text);
  },

  openExternal: (url: string) => {
    ipcRenderer.send('open-external', url);
  },
});

// 1. 彻底抹除右下角遮挡操作的“仅供内部测试”标签
// 2. 在左下方（侧边栏底部）精确呈现完全对齐 ZCode 样式的“移动端远程控制”卡片
window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.id = 'desktop-clean-style';
  style.textContent = `
    .internal-build-fab, .internal-build-tag, [class*="internal-build"] {
      display: none !important;
      opacity: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
      width: 0 !important;
      height: 0 !important;
      position: absolute !important;
      left: -9999px !important;
    }

    /* 侧边栏底部自适应：设置按钮与手机扫码按钮优雅并排 */
    .side-footer {
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      padding: 8px 12px !important;
      position: relative !important;
    }

    .side-footer .btn-settings {
      flex: 1 !important;
      min-width: 0 !important;
    }

    .btn-desktop-qr {
      flex: none !important;
      width: 32px !important;
      height: 32px !important;
      border-radius: var(--radius-sm, 6px) !important;
      background: transparent !important;
      border: none !important;
      color: var(--color-text-muted, #71717a) !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      transition: all 0.15s ease !important;
      padding: 0 !important;
    }

    .btn-desktop-qr:hover {
      background: var(--sb-hover, rgba(255, 255, 255, 0.08)) !important;
      color: var(--color-text, #f4f4f5) !important;
    }

    .btn-desktop-qr:active {
      transform: scale(0.96) !important;
    }
  `;
  document.head.appendChild(style);

  function mountCompactButton() {
    const sideFooter = document.querySelector('.side-footer');
    const settingsBtn = sideFooter?.querySelector('.btn-settings');
    if (sideFooter && !document.getElementById('desktop-qr-trigger')) {
      const btn = document.createElement('button');
      btn.id = 'desktop-qr-trigger';
      btn.className = 'btn-desktop-qr';
      btn.type = 'button';
      btn.title = '手机扫码控制 (快捷键 Cmd+M)';
      btn.innerHTML = `
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
          <line x1="12" y1="18" x2="12.01" y2="18"></line>
        </svg>
      `;

      btn.onclick = (e: MouseEvent) => {
        e.stopPropagation();
        ipcRenderer.send('open-remote-modal');
      };

      // 位置对换：将手机扫码按钮插入到设置按钮前面（左侧）
      if (settingsBtn) {
        sideFooter.insertBefore(btn, settingsBtn);
      } else {
        sideFooter.appendChild(btn);
      }
    }
  }

  setTimeout(mountCompactButton, 300);
  setInterval(mountCompactButton, 1500);
});
