const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const PRODUCT_NAME = 'Clippahh';
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Clippahh-data'));
}
let postgresProcess = null;
let nextProcess = null;
let mainWindow = null;
let shuttingDown = false;
let postgresPort = null;
let appPort = null;

function resource(...parts) {
  return path.join(process.resourcesPath, ...parts);
}

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      ...options,
      stdio: options.stdio || 'ignore',
    });
    let stderr = '';
    if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(executable)} exited with code ${code}${stderr ? `: ${stderr.slice(-2000)}` : ''}`));
    });
  });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(check, label, timeoutMs = 45000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

async function startDatabase() {
  const bin = resource('postgres', 'bin');
  const dataDir = path.join(app.getPath('userData'), 'postgres');
  const logFile = path.join(app.getPath('userData'), 'postgres.log');
  const initdb = path.join(bin, 'initdb.exe');
  const pgCtl = path.join(bin, 'pg_ctl.exe');
  const psql = path.join(bin, 'psql.exe');
  const createdb = path.join(bin, 'createdb.exe');

  for (const file of [initdb, pgCtl, psql, createdb]) {
    if (!fs.existsSync(file)) throw new Error(`Bundled PostgreSQL executable is missing: ${file}`);
  }
  fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  postgresPort = await freePort();

  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    await run(initdb, ['-D', dataDir, '-U', 'postgres', '--encoding=UTF8', '--auth-local=trust', '--auth-host=trust']);
  }

  await run(pgCtl, ['-D', dataDir, '-l', logFile, '-o', `-h 127.0.0.1 -p ${postgresPort}`, '-w', 'start']);
  postgresProcess = { pgCtl, dataDir };

  const env = { ...process.env, PGHOST: '127.0.0.1', PGPORT: String(postgresPort), PGUSER: 'postgres' };
  const existingDb = await run(psql, ['-h', '127.0.0.1', '-p', String(postgresPort), '-U', 'postgres', '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname = 'clippahh'"], { env });
  if (!existingDb.stdout.trim()) {
    await run(createdb, ['-h', '127.0.0.1', '-p', String(postgresPort), '-U', 'postgres', 'clippahh'], { env });
  }
  await run(psql, ['-h', '127.0.0.1', '-p', String(postgresPort), '-U', 'postgres', '-d', 'clippahh', '-v', 'ON_ERROR_STOP=1', '-f', resource('clippahh-schema.sql')], { env });
}

async function startNextServer() {
  appPort = await freePort();
  const serverFile = resource('app', 'server.js');
  if (!fs.existsSync(serverFile)) throw new Error('Packaged Next.js server is missing. Rebuild the desktop package.');
  const dataDir = path.join(app.getPath('userData'), 'ClippahhData');
  fs.mkdirSync(dataDir, { recursive: true });
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    HOSTNAME: '127.0.0.1',
    PORT: String(appPort),
    CLIPPAHH_DATA_DIR: dataDir,
    DATABASE_URL: `postgresql://postgres@127.0.0.1:${postgresPort}/clippahh`,
  };
  nextProcess = spawn(process.execPath, [serverFile], {
    cwd: resource('app'),
    env,
    windowsHide: true,
    stdio: 'ignore',
  });
  nextProcess.once('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      dialog.showErrorBox(PRODUCT_NAME, `The local application server stopped unexpectedly (code ${code ?? 'unknown'}).`);
      app.quit();
    }
  });
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/health`);
    return response.ok;
  }, 'Clippahh application server');
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    backgroundColor: '#09090b',
    title: PRODUCT_NAME,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadURL(`http://127.0.0.1:${appPort}`);
}

async function stopServices() {
  shuttingDown = true;
  if (nextProcess && !nextProcess.killed) nextProcess.kill();
  if (postgresProcess) {
    await run(postgresProcess.pgCtl, ['-D', postgresProcess.dataDir, '-m', 'fast', '-w', 'stop']).catch(() => {});
    postgresProcess = null;
  }
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.clippahh.desktop');
  try {
    await startDatabase();
    await startNextServer();
    await createWindow();
  } catch (error) {
    dialog.showErrorBox(`${PRODUCT_NAME} could not start`, error instanceof Error ? error.message : String(error));
    await stopServices();
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (!shuttingDown && postgresProcess) {
    event.preventDefault();
    stopServices().finally(() => app.quit());
  }
});
