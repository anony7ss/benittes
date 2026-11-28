import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const entrypoint = path.join(directory, 'index.js');
let child = null;
let restartTimer = null;
let killTimer = null;
let stopping = false;
let restartCount = 0;
let childStartedAt = 0;

function startWorker() {
  if (stopping) return;
  childStartedAt = Date.now();
  child = spawn(process.execPath, [entrypoint], {
    cwd: directory,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });

  child.once('error', (error) => {
    console.error(`[Supervisor] Não foi possível iniciar o bot: ${error.message}`);
  });

  child.once('exit', (code, signal) => {
    child = null;
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = null;
    }
    if (stopping) {
      process.exit(code ?? 0);
      return;
    }

    if (Date.now() - childStartedAt >= 5 * 60_000) restartCount = 0;
    const delayMs = Math.min(1000 * 2 ** Math.min(restartCount, 5), 30_000);
    restartCount += 1;
    console.error(`[Supervisor] O bot encerrou (código ${code ?? '—'}, sinal ${signal ?? '—'}). Nova tentativa em ${Math.ceil(delayMs / 1000)}s; sessão preservada.`);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      startWorker();
    }, delayMs);
  });
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (!child) {
    process.exit(0);
    return;
  }

  console.log(`[Supervisor] Encerrando o bot com ${signal}...`);
  child.kill(signal);
  killTimer = setTimeout(() => {
    if (child) child.kill('SIGKILL');
  }, 8000);
  if (killTimer.unref) killTimer.unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
startWorker();
