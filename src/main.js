const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, nativeTheme, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Engine } = require('./engine');
const Store = require('./store');
const { autoUpdater } = require('electron-updater');

app.setAppUserModelId('app.snag.downloader');
if (!app.requestSingleInstanceLock()) app.quit();

const theme = () => (nativeTheme.shouldUseDarkColors
  ? { color: '#161618', symbolColor: '#c8c8ce', height: 44 }
  : { color: '#ffffff', symbolColor: '#3f3f46', height: 44 });
let win, engine, settings, library;
let engineState = { ready: false, busy: 'Starting the engine' };
let markEngineReady;
const engineReady = new Promise((r) => { markEngineReady = r; });
const jobs = new Map();     // id -> job snapshot
const running = new Map();  // id -> { cancel }

let updateState = { state: 'idle', current: app.getVersion() };
const sendUpdate = (patch) => {
  updateState = { ...updateState, ...patch };
  if (win && !win.isDestroyed()) win.webContents.send('update', updateState);
};

// Updates come from GitHub Releases. Snag asks before downloading and before restarting.
function setupUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (i) => sendUpdate({ state: 'available', version: i.version, error: null }));
  autoUpdater.on('update-not-available', () => { if (updateState.state === 'checking') sendUpdate({ state: 'current' }); });
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: p.percent / 100 }));
  autoUpdater.on('update-downloaded', (i) => sendUpdate({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => {
    // A failed background check (offline, no releases yet) stays quiet; failures the user started are shown.
    if (['downloading', 'checking'].includes(updateState.state)) sendUpdate({ state: 'error', error: e.message });
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(() => { if (['idle', 'current', 'error'].includes(updateState.state)) check(); }, 6 * 3600 * 1000);
}

const sendJob = (j) => win && !win.isDestroyed() && win.webContents.send('job', j);
const sendEngine = () => win && !win.isDestroyed() && win.webContents.send('engine', engineState);

// History: every finished download, kept across restarts (newest first).
const LIBRARY_MAX = 5000;
const libraryItem = (j) => ({
  id: j.id, finished: j.finished || Date.now(), url: j.url, kind: j.kind, mode: j.mode, height: j.height ?? null,
  title: j.title, thumbnail: j.thumbnail || null, site: j.site || null, uploader: j.uploader || null,
  duration: j.duration || null, count: j.count || null, file: j.file || null, files: j.files || null,
  size: j.size || null, specs: j.specs || null,
});
function addToLibrary(j) {
  const items = [libraryItem(j), ...(library.get('items') || []).filter((x) => x.id !== j.id)].slice(0, LIBRARY_MAX);
  library.set({ items });
  if (win && !win.isDestroyed()) win.webContents.send('library-add', { ...items[0], exists: true });
}

function update(id, patch) {
  const j = jobs.get(id);
  if (!j) return;
  Object.assign(j, patch);
  if (['done', 'error', 'canceled'].includes(patch.status)) {
    running.delete(id);
    j.finished = Date.now();
    if (patch.status === 'done') addToLibrary(j);
    pump();
  }
  sendJob(j);
}

// Spec lookups each start a yt-dlp process; run at most three at once.
let specSlots = 3;
const specWaiters = [];
async function withSpecSlot(fn) {
  if (specSlots === 0) await new Promise((r) => specWaiters.push(r));
  specSlots--;
  try { return await fn(); } finally { specSlots++; const next = specWaiters.shift(); if (next) next(); }
}

// Start queued jobs up to the concurrency limit.
function pump() {
  if (!engine || !engineState.ready) return;
  const limit = Math.max(1, Number(settings.get('concurrent')) || 3);
  const queued = [...jobs.values()].filter((j) => j.status === 'queued').sort((a, b) => a.created - b.created);
  for (const j of queued) {
    if (running.size >= limit) break;
    fs.mkdirSync(j.folder, { recursive: true });
    update(j.id, { status: 'downloading', stage: 'Starting', percent: 0, error: null });
    running.set(j.id, engine.download(j, settings.data, (p) => update(j.id, p)));
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1080, height: 780, minWidth: 760, minHeight: 560,
    backgroundColor: theme().color, show: false, title: 'Snag',
    icon: path.join(__dirname, 'renderer', 'icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: theme(),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// Appearance. "time" (default): light 7:00 AM to 4:59 PM, dark 5:00 PM to 6:59 AM, by this PC's clock.
// Setting nativeTheme.themeSource drives the page's prefers-color-scheme and the title bar together.
const DAY_START = 7, DAY_END = 17;
const isDaytime = (d = new Date()) => d.getHours() >= DAY_START && d.getHours() < DAY_END;
let themeTimer = null;
function applyTheme() {
  const pref = settings.get('theme') || 'time';
  const source = pref === 'time' ? (isDaytime() ? 'light' : 'dark') : pref === 'light' || pref === 'dark' ? pref : 'system';
  if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
  // Wake exactly at the next switch (7:00 or 17:00).
  clearTimeout(themeTimer);
  if (pref === 'time') {
    const now = new Date();
    const next = new Date(now);
    next.setHours(isDaytime(now) ? DAY_END : DAY_START, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    themeTimer = setTimeout(applyTheme, next - now + 250);
  }
}

nativeTheme.on('updated', () => {
  if (!win || win.isDestroyed()) return;
  win.setTitleBarOverlay(theme());
  win.setBackgroundColor(theme().color);
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  const data = app.getPath('userData');
  settings = new Store(path.join(data, 'settings.json'), {
    folder: path.join(app.getPath('downloads'), 'Snag'),
    mode: 'video', height: null, concurrent: 3, fragments: 4,
    cookies: 'none', cookieFile: null,
    metadata: true, thumbnail: true, subtitles: false, watchClipboard: true,
    theme: 'time', lastEngineUpdate: 0,
  });
  applyTheme();
  // Timers pause while the PC sleeps or the clock jumps; re-check on wake and once a minute.
  powerMonitor.on('resume', applyTheme);
  powerMonitor.on('unlock-screen', applyTheme);
  setInterval(applyTheme, 60 * 1000);
  library = new Store(path.join(data, 'library.json'), { items: [] });
  // One-time move: finished downloads from 0.1.x's list become History entries.
  const oldList = path.join(data, 'history.json');
  if (fs.existsSync(oldList)) {
    try {
      const old = JSON.parse(fs.readFileSync(oldList, 'utf8')).jobs || [];
      const known = new Set(library.get('items').map((x) => x.id));
      const moved = old.filter((j) => j.status === 'done' && !known.has(j.id)).map(libraryItem);
      library.set({ items: [...library.get('items'), ...moved].sort((a, b) => b.finished - a.finished) });
      library.flush();
      fs.renameSync(oldList, `${oldList}.moved`);
    } catch {}
  }

  createWindow();

  engine = new Engine(path.join(data, 'bin'));
  const st = await engine.ensure((busy) => { engineState = { ...engineState, busy }; sendEngine(); });
  engineState = { ...st, busy: null };
  sendEngine();
  markEngineReady();
  pump();
  setupUpdates();

  // Sites change often; refresh yt-dlp in the background once a day.
  if (st.ready && st.managed && Date.now() - (settings.get('lastEngineUpdate') || 0) > 86400000) {
    const r = await engine.update();
    if (r.ok) settings.set({ lastEngineUpdate: Date.now() });
    engineState = { ...engine.status(), busy: null };
    sendEngine();
  }
});

app.on('window-all-closed', () => {
  for (const r of running.values()) r.cancel();
  settings && settings.flush();
  library && library.flush();
  app.quit();
});

// ---------- IPC ----------
ipcMain.handle('init', () => ({
  settings: settings.data,
  jobs: [...jobs.values()].sort((a, b) => b.created - a.created),
  engine: engineState,
  update: updateState,
}));

ipcMain.handle('update-check', async () => {
  if (!app.isPackaged) return sendUpdate({ state: 'current' });
  sendUpdate({ state: 'checking', error: null });
  try { await autoUpdater.checkForUpdates(); } catch (e) { sendUpdate({ state: 'error', error: e.message }); }
});
ipcMain.handle('update-download', () => {
  sendUpdate({ state: 'downloading', percent: 0, error: null });
  autoUpdater.downloadUpdate().catch((e) => sendUpdate({ state: 'error', error: e.message }));
});
ipcMain.handle('update-install', () => {
  for (const r of running.values()) r.cancel();
  settings.flush(); library.flush();
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
});

ipcMain.handle('probe', async (_e, url) => {
  await engineReady;
  if (!engineState.ready) return { error: 'The download engine could not be installed. Check your internet connection and restart Snag.' };
  try { return await engine.probe(url, settings.data); } catch (e) { return { error: e.message }; }
});

ipcMain.handle('enqueue', (_e, req) => {
  const j = {
    id: crypto.randomUUID(), created: Date.now(), status: 'queued',
    url: req.url, kind: req.kind || 'video', mode: req.mode || settings.get('mode'),
    height: req.height ?? null, folder: settings.get('folder'),
    title: req.title || req.url, thumbnail: req.thumbnail || null, site: req.site || null,
    uploader: req.uploader || null, duration: req.duration || null, count: req.count || null,
    percent: 0,
  };
  jobs.set(j.id, j);
  sendJob(j);
  pump();
  return j;
});

ipcMain.handle('cancel', (_e, id) => {
  const r = running.get(id);
  if (r) r.cancel();
  else if (jobs.get(id)?.status === 'queued') update(id, { status: 'canceled' });
});

ipcMain.handle('retry', (_e, id) => {
  const j = jobs.get(id);
  if (!j || running.has(id)) return;
  update(id, { status: 'queued', percent: 0, error: null, stage: null, created: Date.now(), folder: settings.get('folder') });
  pump();
});

// Removing from Downloads only tidies this session's list; History keeps the entry.
ipcMain.handle('remove', (_e, id) => {
  if (running.has(id)) return;
  jobs.delete(id);
});

ipcMain.handle('clear-finished', () => {
  for (const [id, j] of jobs) if (['done', 'error', 'canceled'].includes(j.status)) jobs.delete(id);
});

ipcMain.handle('specs', async (_e, key, mode, height) => {
  try { return await withSpecSlot(() => engine.specs(key, mode, height)); } catch { return null; }
});

ipcMain.handle('library', () => (library.get('items') || []).map((x) => ({
  ...x, exists: !!(x.file && fs.existsSync(x.file)) || !!(x.files && x.files.some((f) => fs.existsSync(f))),
})));
ipcMain.handle('library-remove', (_e, id) => { library.set({ items: library.get('items').filter((x) => x.id !== id) }); });
ipcMain.handle('library-clear', async () => {
  const r = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Clear history', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
    title: 'Clear history', message: 'Clear your download history?', detail: 'The list is emptied. Your downloaded files stay where they are.',
  });
  if (r.response !== 0) return false;
  library.set({ items: [] });
  return true;
});

ipcMain.handle('open-file', async (_e, p) => (p && fs.existsSync(p) ? (await shell.openPath(p)) || true : false));
ipcMain.handle('show-file', (_e, p) => { if (p && fs.existsSync(p)) { shell.showItemInFolder(p); return true; } return false; });
ipcMain.handle('open-folder', () => { const f = settings.get('folder'); fs.mkdirSync(f, { recursive: true }); shell.openPath(f); });
ipcMain.handle('open-external', (_e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });

ipcMain.handle('choose-folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Save downloads to', defaultPath: settings.get('folder'), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  settings.set({ folder: r.filePaths[0] });
  return r.filePaths[0];
});

ipcMain.handle('choose-cookie-file', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a cookies.txt file', filters: [{ name: 'Cookies', extensions: ['txt'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  settings.set({ cookieFile: r.filePaths[0], cookies: 'file' });
  return r.filePaths[0];
});

const SETTABLE = ['mode', 'height', 'concurrent', 'fragments', 'cookies', 'metadata', 'thumbnail', 'subtitles', 'watchClipboard', 'theme'];
ipcMain.handle('set-settings', (_e, patch) => {
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => SETTABLE.includes(k)));
  if (clean.theme && !['time', 'system', 'light', 'dark'].includes(clean.theme)) delete clean.theme;
  settings.set(clean);
  if ('theme' in clean) applyTheme();
  pump();
  return settings.data;
});

ipcMain.handle('update-engine', async () => {
  engineState = { ...engineState, busy: 'Updating the engine' };
  sendEngine();
  const r = await engine.update();
  if (r.ok) settings.set({ lastEngineUpdate: Date.now() });
  engineState = { ...engine.status(), busy: null };
  sendEngine();
  return r;
});

ipcMain.handle('read-clipboard', () => clipboard.readText());

ipcMain.handle('install-ffmpeg', async () => {
  if (engineState.busy) return { ok: false, message: 'Snag is busy. Try again in a moment.' };
  const ok = await engine.installFfmpeg((busy) => { engineState = { ...engineState, busy }; sendEngine(); });
  engineState = { ...engine.status(), busy: null };
  sendEngine();
  pump();
  return { ok, message: ok ? 'FFmpeg installed' : 'Could not install FFmpeg. Check your internet connection and try again.' };
});
