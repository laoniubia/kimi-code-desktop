import { build } from 'esbuild';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const distDir = 'dist';
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}
mkdirSync(join(distDir, 'main'), { recursive: true });

console.log('[Build] 正在编译 Electron 主进程与预加载脚本...');

// 编译主进程
await build({
  entryPoints: ['src/main/index.ts'],
  outfile: 'dist/main/index.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: true,
});

// 编译预加载脚本
await build({
  entryPoints: ['src/main/preload.ts'],
  outfile: 'dist/main/preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: true,
});

console.log('[Build] 编译完成 -> dist/main/');
