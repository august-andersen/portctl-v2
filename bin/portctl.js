#!/usr/bin/env node

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { execFile, spawn } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_SERVER_ENTRY = path.join(ROOT_DIR, 'dist', 'server', 'index.js');

function resolvePaths() {
  const rootDir = process.env.PORTCTL_HOME
    ? path.resolve(process.env.PORTCTL_HOME)
    : path.join(os.homedir(), '.portctl');
  return {
    rootDir,
    logsDir: path.join(rootDir, 'logs'),
    configFile: path.join(rootDir, 'config.json'),
    pidFile: path.join(rootDir, 'portctl.pid'),
    stateFile: path.join(rootDir, 'state.json'),
    daemonLogFile: path.join(rootDir, 'logs', 'daemon.log'),
  };
}

async function ensureDirectories() {
  const paths = resolvePaths();
  await fsp.mkdir(paths.rootDir, { recursive: true });
  await fsp.mkdir(paths.logsDir, { recursive: true });
  return paths;
}

async function getConfiguredPort() {
  const paths = resolvePaths();
  try {
    const raw = await fsp.readFile(paths.configFile, 'utf8');
    const parsed = JSON.parse(raw);
    const port = parsed?.settings?.dashboardPort;
    return Number.isInteger(port) ? port : 47777;
  } catch {
    return 47777;
  }
}

async function readState() {
  const paths = resolvePaths();
  try {
    const raw = await fsp.readFile(paths.stateFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readPid() {
  const paths = resolvePaths();
  try {
    const raw = await fsp.readFile(paths.pidFile, 'utf8');
    const pid = Number.parseInt(raw.trim(), 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function checkHealth(port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/api/status',
        timeout: timeoutMs,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed?.ok ? parsed : null);
          } catch {
            resolve(null);
          }
        });
      },
    );

    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
    request.on('error', () => {
      resolve(null);
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForHealth(port, attempts = 20, delayMs = 300) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await checkHealth(port);
    if (status) {
      return status;
    }
    await wait(delayMs);
  }

  return null;
}

function execFileAsync(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function isPortOccupiedByOtherProcess(port) {
  try {
    const { stdout } = await execFileAsync('lsof', [
      '-nP',
      `-iTCP:${port}`,
      '-sTCP:LISTEN',
      '-Fp',
    ]);

    return stdout
      .split('\n')
      .some((line) => line.startsWith('p') && line.length > 1);
  } catch {
    return false;
  }
}

async function resolveRunningStatus() {
  const configuredPort = await getConfiguredPort();
  const state = await readState();
  const candidatePorts = [
    state?.dashboardPort,
    configuredPort,
  ].filter((value, index, array) => Number.isInteger(value) && array.indexOf(value) === index);

  for (const port of candidatePorts) {
    const status = await checkHealth(port);
    if (status) {
      return status;
    }
  }

  return null;
}

async function startDaemon() {
  const paths = await ensureDirectories();
  const existing = await resolveRunningStatus();
  if (existing) {
    console.log(`Dashboard already running at ${existing.url}`);
    return;
  }

  const configuredPort = await getConfiguredPort();
  const occupied = await isPortOccupiedByOtherProcess(configuredPort);
  if (occupied) {
    console.error(
      `Port ${configuredPort} is already in use by another process. Change "dashboardPort" in ~/.portctl/config.json and try again.`,
    );
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(DIST_SERVER_ENTRY)) {
    console.error('portctl is not built yet. Run "npm install" and "npm run build" first.');
    process.exitCode = 1;
    return;
  }

  const logFd = fs.openSync(paths.daemonLogFile, 'a');
  const child = spawn(process.execPath, [DIST_SERVER_ENTRY], {
    detached: true,
    env: {
      ...process.env,
      PORTCTL_DAEMON: '1',
    },
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);

  const status = await waitForHealth(configuredPort);
  if (!status) {
    console.error(
      `portctl did not start cleanly. Check ${paths.daemonLogFile} for details.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Dashboard running at ${status.url}`);
}

async function stopDaemon() {
  const status = await resolveRunningStatus();
  const pid = status?.pid ?? (await readPid());

  if (!pid || !isPidRunning(pid)) {
    console.log('portctl is not running.');
    return;
  }

  process.kill(pid, 'SIGTERM');

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!isPidRunning(pid)) {
      console.log('portctl stopped.');
      return;
    }
    await wait(150);
  }

  console.error('portctl did not stop cleanly.');
  process.exitCode = 1;
}

async function showStatus() {
  const status = await resolveRunningStatus();
  if (!status) {
    console.log('portctl is not running.');
    return;
  }

  console.log(`Status: running`);
  console.log(`PID: ${status.pid}`);
  console.log(`Uptime: ${status.uptime ?? 'unknown'}`);
  console.log(`URL: ${status.url}`);
}

async function openDashboard() {
  const status = await resolveRunningStatus();
  if (!status) {
    console.error('portctl is not running.');
    process.exitCode = 1;
    return;
  }

  await execFileAsync('open', [status.url]);
  console.log(`Opened ${status.url}`);
}

function confirm(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function uninstall() {
  const answer = await confirm(
    'This will remove the daemon, CLI links, config, logs, and ~/.portctl. Continue? [y/N] ',
  );
  if (answer !== 'y' && answer !== 'yes') {
    console.log('Uninstall cancelled.');
    return;
  }

  await stopDaemon();

  const candidateLinks = [
    '/usr/local/bin/portctl',
    '/opt/homebrew/bin/portctl',
    path.join(os.homedir(), '.local', 'bin', 'portctl'),
  ];

  for (const linkPath of candidateLinks) {
    try {
      const stats = await fsp.lstat(linkPath);
      if (stats.isSymbolicLink() || stats.isFile()) {
        await fsp.rm(linkPath, { force: true });
      }
    } catch {
      // Not installed there.
    }
  }

  await fsp.rm(resolvePaths().rootDir, { recursive: true, force: true });
  console.log('portctl was uninstalled.');
}

async function restartDaemon() {
  await stopDaemon();
  await startDaemon();
}

async function main() {
  const command = process.argv[2] ?? 'status';

  switch (command) {
    case 'start':
      await startDaemon();
      break;
    case 'stop':
      await stopDaemon();
      break;
    case 'restart':
      await restartDaemon();
      break;
    case 'status':
      await showStatus();
      break;
    case 'open':
      await openDashboard();
      break;
    case 'uninstall':
      await uninstall();
      break;
    default:
      console.log(
        'Usage: portctl <start|stop|restart|status|open|uninstall>',
      );
      process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
