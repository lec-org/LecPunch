import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const command = (name) => (process.platform === 'win32' ? `${name}.cmd` : name);

const run = (file, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${file} exited with code ${code}`)));
});

const builderHome = path.join(os.tmpdir(), 'lecpunch-electron-builder');
const builderCli = path.join(builderHome, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
const outputDirectory = process.env.LECPUNCH_ELECTION_OUTPUT_DIR || path.join(os.homedir(), 'Downloads', 'LecPunch-Election-Installer');

await run(command('pnpm'), ['build']);

// NSIS has a legacy path-length limit. Keeping the packager in a short temporary
// path lets the command work even when this repository is nested deeply.
if (!existsSync(builderCli)) {
  await run(command('npm'), ['install', '--prefix', builderHome, 'electron-builder@26.15.3', '--ignore-scripts', '--no-audit', '--no-fund']);
}

await run(process.execPath, [
  builderCli,
  '--win',
  'nsis',
  '--x64',
  `--config.directories.output=${outputDirectory}`
], {
  env: {
    ...process.env,
    ELECTRON_BUILDER_BINARIES_MIRROR: process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/'
  }
});

console.log(`Windows installer created in: ${outputDirectory}`);
