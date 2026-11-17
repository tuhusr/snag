const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('snag', {
  init: call('init'),
  probe: call('probe'),
  enqueue: call('enqueue'),
  cancel: call('cancel'),
  retry: call('retry'),
  remove: call('remove'),
  clearFinished: call('clear-finished'),
  openFile: call('open-file'),
  showFile: call('show-file'),
  openFolder: call('open-folder'),
  chooseFolder: call('choose-folder'),
  chooseCookieFile: call('choose-cookie-file'),
  setSettings: call('set-settings'),
  updateEngine: call('update-engine'),
  installFfmpeg: call('install-ffmpeg'),
  readClipboard: call('read-clipboard'),
  openExternal: call('open-external'),
  onJob: (fn) => ipcRenderer.on('job', (_e, j) => fn(j)),
  onEngine: (fn) => ipcRenderer.on('engine', (_e, s) => fn(s)),
  specs: call('specs'),
  library: call('library'),
  libraryRemove: call('library-remove'),
  libraryClear: call('library-clear'),
  onLibraryAdd: (fn) => ipcRenderer.on('library-add', (_e, x) => fn(x)),
  checkUpdate: call('update-check'),
  downloadUpdate: call('update-download'),
  installUpdate: call('update-install'),
  onUpdate: (fn) => ipcRenderer.on('update', (_e, s) => fn(s)),
});
