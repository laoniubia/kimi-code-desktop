import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 修复 macOS GUI 应用程序环境下 PATH 与环境变量缺失问题
 * macOS 桌面应用从 Finder / Dock / Spotlight / Launchpad 启动时，不会继承终端完整的 PATH
 */
export function fixEnvironment(): void {
  if (process.platform !== 'darwin') return;

  const userHome = homedir();
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

  const currentPathList = (process.env.PATH || '').split(':').filter(Boolean);
  const shellPathList = shellPath ? shellPath.split(':').filter(Boolean) : [];

  // 合并并去重，只保留本机实际存在的目录
  const combined = Array.from(
    new Set([...shellPathList, ...standardPaths, ...currentPathList])
  ).filter((dir) => existsSync(dir));

  process.env.PATH = combined.join(':');

  if (!process.env.LANG) {
    process.env.LANG = 'zh_CN.UTF-8';
  }
}

/**
 * 寻找 Node.js 可执行文件路径
 */
export function findNodeExecutable(): string {
  const userHome = homedir();
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

  const pathDirs = (process.env.PATH || '').split(':').filter(Boolean);
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

  // 1. 检查 npm-global 中的 kimi 入口
  const globalKimi = join(userHome, '.npm-global/bin/kimi');
  if (existsSync(globalKimi)) {
    return { execPath: globalKimi, isDirectScript: true };
  }

  // 2. 检查 PATH 中的 kimi
  const pathDirs = (process.env.PATH || '').split(':').filter(Boolean);
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
