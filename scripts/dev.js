import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const children = [];
const closedChildren = new Set();
let stopping = false;
let forceStopTimer;
let exitCode = 0;

function terminate(child, force = false) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
    return;
  }

  if (isWindows) {
    const args = ['/PID', String(child.pid), '/T'];
    if (force) args.push('/F');

    const taskkill = spawn('taskkill', args, { stdio: 'inherit' });
    taskkill.on('error', (error) => {
      console.error(`Failed to stop process tree ${child.pid}:`, error.message);
    });
    return;
  }

  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') {
      console.error(`Failed to stop process tree ${child.pid}:`, error.message);
    }
  }
}

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  exitCode = code;

  for (const child of children) terminate(child);

  forceStopTimer = setTimeout(() => {
    for (const child of children) terminate(child, true);
  }, 5000);
  forceStopTimer.unref();
}

function start(script) {
  const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = isWindows
    ? ['/d', '/s', '/c', `npm run ${script}`]
    : ['run', script];
  const child = spawn(command, args, {
    detached: !isWindows,
    stdio: 'inherit',
  });

  children.push(child);
  child.on('error', (error) => {
    console.error(`Failed to start ${script}:`, error.message);
    stopAll(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      const result = signal ? `signal ${signal}` : `code ${code}`;
      console.error(`${script} exited unexpectedly (${result}); stopping the other server.`);
      stopAll(code === 0 ? 1 : code ?? 1);
    }
  });
  child.on('close', () => {
    closedChildren.add(child);
    if (stopping && closedChildren.size === children.length) {
      clearTimeout(forceStopTimer);
      process.exitCode = exitCode;
    }
  });
}

process.on('SIGINT', () => stopAll(130));
process.on('SIGTERM', () => stopAll(143));

start('dev:backend');
start('dev:frontend');
