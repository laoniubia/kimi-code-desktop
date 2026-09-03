import { spawn } from 'node:child_process';
import './build.mjs';

console.log('[Dev] 正在启动 Kimi Code 桌面客户端...');

const electronProcess = spawn('npx', ['electron', '.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
  },
});

electronProcess.on('close', (code) => {
  console.log(`[Dev] Electron 进程已退出，code=${code}`);
  process.exit(code || 0);
});
