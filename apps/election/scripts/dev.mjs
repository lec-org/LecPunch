import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const children = [];
let closing = false;

const closeAll = (code = 0) => {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  process.exit(code);
};

const run = (command, args) => {
  const child = spawn(command, args, { stdio: 'inherit' });
  children.push(child);
  child.on('exit', (code) => {
    if (!closing && code && code !== 0) closeAll(code);
  });
  return child;
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const rendererReady = async () => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (existsSync('.electron/main.js')) {
      try {
        const response = await fetch('http://127.0.0.1:5174');
        if (response.ok) return;
      } catch {
        // Vite is still starting.
      }
    }
    await delay(250);
  }
  throw new Error('Electron renderer did not start within 30 seconds.');
};

process.on('SIGINT', () => closeAll());
process.on('SIGTERM', () => closeAll());

run(pnpm, ['dev:electron']);
run(pnpm, ['dev:renderer']);

try {
  await rendererReady();
  run(process.execPath, ['./node_modules/electron/cli.js', '.']);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  closeAll(1);
}
