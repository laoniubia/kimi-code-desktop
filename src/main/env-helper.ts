import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { join, delimiter, basename } from 'node:path';

/**
 * 修复 macOS / Windows GUI 应用程序环境下 PATH 与环境变量缺失问题
 * 桌面应用从 Finder / Dock 或 Windows 快捷方式启动时，可能无法继承完整的命令行 PATH
 */
export function fixEnvironment(): void {
  const userHome = homedir();
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  if (!isWin && !isMac) return;

  if (isWin) {
    const standardPaths = [
      join(process.env.APPDATA || '', 'npm'),
      join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
      'C:\\Program Files\\nodejs',
      'C:\\Program Files (x86)\\nodejs',
      join(userHome, '.cargo', 'bin'),
      join(userHome, '.bun', 'bin'),
      join(userHome, 'AppData', 'Roaming', 'npm'),
      join(userHome, 'AppData', 'Local', 'Programs', 'nodejs'),
    ];

    const currentPathList = (process.env.PATH || process.env.Path || '')
      .split(delimiter)
      .filter(Boolean);

    const combined = Array.from(
      new Set([...currentPathList, ...standardPaths])
    ).filter((dir) => Boolean(dir) && existsSync(dir));

    process.env.PATH = combined.join(delimiter);
    return;
  }

  // macOS
  const standardPaths = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    join(userHome, '.npm-global/bin'),
    join(userHome, '.bun/bin'),
    join(userHome, '.cargo/bin'),
    join(userHome, '.local/bin'),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];

  // 尝试从用户的默认登录 Shell (zsh/bash) 获取其真实配置的 PATH
  let shellPath = '';
  try {
    const defaultShell = process.env.SHELL || '/bin/zsh';
    shellPath = execSync(`${defaultShell} -ilc 'echo -n "$PATH"'`, {
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // 忽略异常，降级到内置标准路径
  }

  const currentPathList = (process.env.PATH || '').split(delimiter).filter(Boolean);
  const shellPathList = shellPath ? shellPath.split(delimiter).filter(Boolean) : [];

  // 合并并去重，只保留本机实际存在的目录
  const combined = Array.from(
    new Set([...shellPathList, ...standardPaths, ...currentPathList])
  ).filter((dir) => existsSync(dir));

  process.env.PATH = combined.join(delimiter);

  if (!process.env.LANG) {
    process.env.LANG = 'zh_CN.UTF-8';
  }
}

/**
 * 寻找 Node.js 可执行文件路径
 */
export function findNodeExecutable(): string {
  const userHome = homedir();
  const isWin = process.platform === 'win32';

  if (isWin) {
    // 1. 检查当前运行进程是否为 node (非 electron 包装体)
    if (
      process.execPath &&
      basename(process.execPath).toLowerCase().startsWith('node') &&
      existsSync(process.execPath)
    ) {
      return process.execPath;
    }

    // 2. 检查 Windows 常见标准安装路径
    const winCandidates = [
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
      join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
      join(process.env.APPDATA || '', 'npm', 'node.exe'),
      join(userHome, '.bun', 'bin', 'node.exe'),
      join(userHome, 'AppData', 'Local', 'Programs', 'nodejs', 'node.exe'),
    ];

    for (const candidate of winCandidates) {
      if (candidate && existsSync(candidate)) {
        return candidate;
      }
    }

    // 3. 执行 where node.exe / where node
    try {
      const whereOut = execSync('where node.exe', {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const firstPath = whereOut.split(/\r?\n/)[0]?.trim();
      if (firstPath && existsSync(firstPath)) {
        return firstPath;
      }
    } catch {
      try {
        const whereOut = execSync('where node', {
          encoding: 'utf8',
          timeout: 1500,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        const firstPath = whereOut.split(/\r?\n/)[0]?.trim();
        if (firstPath && existsSync(firstPath)) {
          return firstPath;
        }
      } catch {
        // ignore
      }
    }

    // 4. 从 PATH 遍历
    const pathDirs = (process.env.PATH || process.env.Path || '')
      .split(delimiter)
      .filter(Boolean);
    for (const dir of pathDirs) {
      const fullExe = join(dir, 'node.exe');
      if (existsSync(fullExe)) {
        return fullExe;
      }
      const full = join(dir, 'node');
      if (existsSync(full)) {
        return full;
      }
    }

    return 'node.exe';
  }

  // macOS / Linux
  const directCandidates = [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    join(userHome, '.bun/bin/node'),
  ];

  for (const candidate of directCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const pathDirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const full = join(dir, 'node');
    if (existsSync(full)) {
      return full;
    }
  }

  return 'node';
}

/**
 * 寻找 Kimi Code CLI 脚本或可执行文件
 */
export function findKimiCli(repoRoot?: string): { execPath: string; isDirectScript: boolean } {
  const userHome = homedir();
  const isWin = process.platform === 'win32';

  if (isWin) {
    // 1. 检查 Windows APPDATA / Roaming 中的 npm 全局 kimi.cmd
    const winGlobalCandidates = [
      join(process.env.APPDATA || '', 'npm', 'kimi.cmd'),
      join(userHome, 'AppData', 'Roaming', 'npm', 'kimi.cmd'),
      join(process.env.LOCALAPPDATA || '', 'Programs', 'kimi', 'kimi.cmd'),
      join(process.env.LOCALAPPDATA || '', 'Programs', 'kimi', 'kimi.exe'),
    ];

    for (const candidate of winGlobalCandidates) {
      if (candidate && existsSync(candidate)) {
        return { execPath: candidate, isDirectScript: false };
      }
    }

    // 2. 检查 where kimi.cmd / where kimi
    try {
      const whereCmd = execSync('where kimi.cmd', {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const firstCmd = whereCmd.split(/\r?\n/)[0]?.trim();
      if (firstCmd && existsSync(firstCmd)) {
        return { execPath: firstCmd, isDirectScript: false };
      }
    } catch {}

    try {
      const whereKimi = execSync('where kimi', {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const firstKimi = whereKimi.split(/\r?\n/)[0]?.trim();
      if (firstKimi && existsSync(firstKimi)) {
        const isJs = firstKimi.endsWith('.js') || firstKimi.endsWith('.mjs');
        return { execPath: firstKimi, isDirectScript: isJs };
      }
    } catch {}

    // 3. 检查 PATH 中的 kimi.cmd / kimi.exe / kimi
    const pathDirs = (process.env.PATH || process.env.Path || '')
      .split(delimiter)
      .filter(Boolean);
    for (const dir of pathDirs) {
      const cmdPath = join(dir, 'kimi.cmd');
      if (existsSync(cmdPath)) {
        return { execPath: cmdPath, isDirectScript: false };
      }
      const exePath = join(dir, 'kimi.exe');
      if (existsSync(exePath)) {
        return { execPath: exePath, isDirectScript: false };
      }
      const plainPath = join(dir, 'kimi');
      if (existsSync(plainPath)) {
        const isJs = plainPath.endsWith('.js') || plainPath.endsWith('.mjs');
        return { execPath: plainPath, isDirectScript: isJs };
      }
    }

    // 4. 检查源码仓库中的入口 (如通过 repo 运行)
    const defaultRepo = repoRoot ?? process.env.KIMI_REPO_ROOT ?? join(userHome, 'repos/kimi-code');
    const repoCli = join(defaultRepo, 'apps/kimi-code/dist/main.mjs');
    if (existsSync(repoCli)) {
      return { execPath: repoCli, isDirectScript: true };
    }

    return { execPath: 'kimi.cmd', isDirectScript: false };
  }

  // macOS / Linux
  // 1. 检查 npm-global 中的 kimi 入口
  const globalKimi = join(userHome, '.npm-global/bin/kimi');
  if (existsSync(globalKimi)) {
    return { execPath: globalKimi, isDirectScript: true };
  }

  // 2. 检查 PATH 中的 kimi
  const pathDirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const full = join(dir, 'kimi');
    if (existsSync(full)) {
      return { execPath: full, isDirectScript: true };
    }
  }

  // 3. 检查源码仓库中的入口
  const defaultRepo = repoRoot ?? process.env.KIMI_REPO_ROOT ?? join(userHome, 'repos/kimi-code');
  const repoCli = join(defaultRepo, 'apps/kimi-code/dist/main.mjs');
  if (existsSync(repoCli)) {
    return { execPath: repoCli, isDirectScript: true };
  }

  return { execPath: 'kimi', isDirectScript: false };
}
