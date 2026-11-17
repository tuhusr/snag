'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { settings: {}, engine: {}, jobs: new Map(), preview: null, probeToken: 0, lastClip: '', mode: 'video', height: null };

const MODES = [
  { id: 'video', label: 'MP4', hint: 'Best quality' },
  { id: 'h264', label: 'MP4 H.264', hint: 'Plays on any device' },
  { id: 'mp3', label: 'MP3', hint: 'Audio only' },
  { id: 'm4a', label: 'M4A', hint: 'Audio only' },
];
const MODE_NAME = { video: 'MP4', h264: 'MP4 H.264', mp3: 'MP3', m4a: 'M4A' };
const SITE_NAME = { Youtube: 'YouTube', YoutubeTab: 'YouTube', TikTok: 'TikTok', Instagram: 'Instagram', Twitter: 'X', Facebook: 'Facebook', Reddit: 'Reddit', Vimeo: 'Vimeo', Twitch: 'Twitch', TwitchVod: 'Twitch', TwitchClips: 'Twitch', Dailymotion: 'Dailymotion', Soundcloud: 'SoundCloud', Generic: 'Web page' };

// ---------- formatting ----------
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const urlsIn = (t) => [...new Set((String(t).match(URL_RE) || []).map((u) => u.replace(/[)\]}.,;:!?]+$/, '')))];
function bytes(n) {
  if (!n || n < 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}
function clock(s) {
  if (s == null || !isFinite(s)) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
function left(s) {
  if (s == null || !isFinite(s)) return '';
  if (s < 60) return `${Math.max(1, Math.round(s))} s left`;
  if (s < 3600) return `${Math.round(s / 60)} min left`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min left`;
}
const siteName = (s) => SITE_NAME[s] || (s ? s.replace(/([a-z])([A-Z])/g, '$1 $2') : '');
const qualityName = (q) => `${q.height}p${q.fps > 30 ? Math.round(q.fps) : ''}${q.hdr ? ' HDR' : ''}`;
const ICON = {
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2h8.8A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>',
  retry: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
};

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- link input ----------
const input = $('#url');

function handleText(text, { auto = false } = {}) {
  const urls = urlsIn(text);
  if (!urls.length) {
    if (!auto) showNotice('That does not look like a link. Copy the address of the video page and paste it here.', text);
    return false;
  }
  if (urls.length > 1) {
    input.value = '';
    hidePreview();
    urls.forEach((url) => window.snag.enqueue({ url, mode: state.mode }));
    toast(`Added ${urls.length} links to downloads`);
    return true;
  }
  input.value = urls[0];
  probe(urls[0]);
  return true;
}

$('#grab').addEventListener('submit', (e) => { e.preventDefault(); if (input.value.trim()) handleText(input.value.trim()); else input.focus(); });
input.addEventListener('paste', (e) => {
  const text = e.clipboardData.getData('text');
  if (urlsIn(text).length) { e.preventDefault(); state.lastClip = text.trim(); handleText(text); }
});

// Paste anywhere in the window goes to the link field.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#settings').hidden) closeSettings();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && document.activeElement !== input && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    input.focus();
  }
});

// Drag a link from the browser onto the window.
window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dropping'); });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dropping');
  const t = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (t) handleText(t);
});

// Pick up a copied link when the user comes back to the window.
window.addEventListener('focus', async () => {
  if (!state.settings.watchClipboard) return;
  const text = ((await window.snag.readClipboard()) || '').trim();
  if (!text || text === state.lastClip) return;
  state.lastClip = text;
  const urls = urlsIn(text);
  if (urls.length === 1 && urls[0] === text && input.value.trim() !== text && !$('#preview').querySelector('.loading')) handleText(text, { auto: true });
});

// ---------- preview ----------
const preview = $('#preview');
function hidePreview() { preview.hidden = true; preview.innerHTML = ''; state.preview = null; }

function showNotice(msg, sub, retry) {
  preview.hidden = false;
  preview.innerHTML = `<div class="notice"><div><p>${esc(msg)}</p>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div>${retry ? '<button class="btn" data-act="retry-probe">Try again</button>' : ''}</div>`;
  if (retry) preview.querySelector('[data-act="retry-probe"]').onclick = () => probe(retry);
}

async function probe(url) {
  const token = ++state.probeToken;
  state.preview = null;
  preview.hidden = false;
  preview.innerHTML = `<div class="card skeleton loading"><div class="thumb"></div><div class="card-body"><div class="line"></div><div class="line"></div><p class="facts">Reading ${esc(new URL(url).hostname.replace(/^www\./, ''))}</p></div></div>`;
  preview.querySelectorAll('.line').forEach((l, i) => { l.style.width = i ? '40%' : '80%'; });
  const r = await window.snag.probe(url);
  if (token !== state.probeToken) return;
  if (r.error) return showNotice(r.error, url, url);
  state.preview = r;
  state.height = null;
  if (!r.hasVideo && (state.mode === 'video' || state.mode === 'h264')) state.mode = 'mp3';
  renderPreview();
}

function renderPreview() {
  const p = state.preview;
  if (!p) return;
  const isAudio = state.mode === 'mp3' || state.mode === 'm4a';
  const facts = [];
  if (p.uploader) facts.push(esc(p.uploader));
  if (p.kind === 'playlist') facts.push(`${p.count || 'Several'} videos`);
  if (p.duration) facts.push(clock(p.duration));
  if (p.site) facts.push(esc(siteName(p.site)));
  if (p.isLive) facts.push('Live now. Records until the stream ends.');

  let quality = '';
  if (!isAudio && p.kind === 'video' && p.qualities && p.qualities.length) {
    const top = p.qualities[0];
    const sz = (q) => (state.mode === 'video' && q.size ? `, about ${bytes(q.size)}` : '');
    quality = `<label class="sr" for="quality">Quality</label><select id="quality">
      <option value="">Best (${qualityName(top)}${sz(top)})</option>
      ${p.qualities.slice(1).map((q) => `<option value="${q.height}" ${state.height === q.height ? 'selected' : ''}>${qualityName(q)}${sz(q)}</option>`).join('')}
    </select>`;
  } else if (!isAudio && p.kind === 'playlist') {
    quality = `<label class="sr" for="quality">Quality</label><select id="quality">
      <option value="">Best available</option>${[2160, 1440, 1080, 720, 480, 360].map((h) => `<option value="${h}" ${state.height === h ? 'selected' : ''}>Up to ${h}p</option>`).join('')}
    </select>`;
  } else if (isAudio && p.audioSize) {
    quality = `<span class="facts">About ${bytes(p.audioSize)}</span>`;
  }

  preview.innerHTML = `<div class="card">
    ${p.thumbnail ? `<img class="thumb" src="${esc(p.thumbnail)}" alt="" referrerpolicy="no-referrer">` : '<div class="thumb"></div>'}
    <div class="card-body">
      <h1 title="${esc(p.title)}">${esc(p.title)}</h1>
      <div class="facts">${facts.map((f) => `<span>${f}</span>`).join('')}</div>
      <div class="choose">
        <div class="modes" role="group" aria-label="Format">
          ${MODES.filter((m) => p.hasVideo !== false || m.id === 'mp3' || m.id === 'm4a').map((m) => `<button type="button" class="mode" data-mode="${m.id}" aria-pressed="${state.mode === m.id}"><b>${m.label}</b><small>${m.hint}</small></button>`).join('')}
        </div>
        ${quality}
        <button class="btn primary" id="startDl">${p.kind === 'playlist' ? `Download ${p.count || 'all'}` : 'Download'}</button>
      </div>
    </div>
  </div>`;

  const img = preview.querySelector('img.thumb');
  if (img) img.onerror = () => { img.replaceWith(Object.assign(document.createElement('div'), { className: 'thumb' })); };
  preview.querySelectorAll('.mode').forEach((b) => b.onclick = () => {
    state.mode = b.dataset.mode;
    window.snag.setSettings({ mode: state.mode });
    renderPreview();
  });
  const q = $('#quality');
  if (q) q.onchange = () => { state.height = q.value ? Number(q.value) : null; };
  $('#startDl').onclick = startDownload;
  $('#startDl').focus();
}

async function startDownload() {
  const p = state.preview;
  if (!p) return;
  const isAudio = state.mode === 'mp3' || state.mode === 'm4a';
  await window.snag.enqueue({
    url: p.url, kind: p.kind, mode: state.mode, height: isAudio ? null : state.height,
    title: p.title, thumbnail: p.thumbnail, site: p.site, uploader: p.uploader, duration: p.duration, count: p.count,
  });
  input.value = '';
  hidePreview();
  input.focus();
}

// ---------- downloads list ----------
const list = $('#jobs');
const rows = new Map();
const dirty = new Set();
let frame = 0;

function queueRender(id) {
  dirty.add(id);
  if (!frame) frame = requestAnimationFrame(flush);
}
function flush() {
  frame = 0;
  for (const id of dirty) renderJob(id);
  dirty.clear();
  updateCounts();
}

function updateCounts() {
  const all = [...state.jobs.values()];
  const active = all.filter((j) => j.status === 'downloading' || j.status === 'processing' || j.status === 'queued').length;
  $('#count').textContent = all.length ? (active ? `${active} active` : `${all.length}`) : '';
  $('#empty').hidden = all.length > 0;
  $('#clearDone').hidden = !all.some((j) => ['done', 'error', 'canceled'].includes(j.status));
  document.title = active ? `Snag (${active})` : 'Snag';
}

function rowFor(j) {
  let li = rows.get(j.id);
  if (li) return li;
  li = document.createElement('li');
  li.className = 'job';
  li.dataset.id = j.id;
  li.innerHTML = '<div class="fill"></div><div class="jthumb"></div><div class="jbody"><div class="jtitle"></div><div class="jmeta"></div></div><div class="counter"></div><div class="jactions"></div>';
  rows.set(j.id, li);
  // newest on top
  const ordered = [...state.jobs.values()].sort((a, b) => b.created - a.created);
  const next = ordered[ordered.findIndex((x) => x.id === j.id) + 1];
  const nextRow = next && rows.get(next.id);
  list.insertBefore(li, nextRow && nextRow.parentNode === list ? nextRow : null);
  return li;
}

function renderJob(id) {
  const j = state.jobs.get(id);
  const li = rows.get(id);
  if (!j) { if (li) { li.remove(); rows.delete(id); } return; }
  const row = rowFor(j);
  const statusChanged = row.dataset.status !== j.status;
  row.dataset.status = j.status;

  const slot = row.querySelector('.jthumb');
  if (j.thumbnail && slot.dataset.src !== j.thumbnail) {
    slot.dataset.src = j.thumbnail;
    const img = Object.assign(new Image(), { alt: '', referrerPolicy: 'no-referrer', src: j.thumbnail });
    img.onerror = () => img.remove();
    slot.replaceChildren(img);
  }

  const title = j.kind === 'playlist' ? j.title : (j.title && j.title !== j.url ? j.title : j.itemTitle || j.title);
  const tEl = row.querySelector('.jtitle');
  if (tEl.textContent !== title) { tEl.textContent = title; tEl.title = title; }

  const pct = Math.max(0, Math.min(1, j.percent || 0));
  row.querySelector('.fill').style.setProperty('--p', pct.toFixed(4));

  const meta = [];
  const fmt = `${MODE_NAME[j.mode] || ''}${(j.mode === 'video' || j.mode === 'h264') && j.height ? ` ${j.height}p` : ''}`;
  let counter = '';
  if (j.status === 'queued') meta.push('Waiting', fmt);
  else if (j.status === 'downloading') {
    counter = `${Math.floor(pct * 100)}%`;
    if (j.kind === 'playlist' && j.item) meta.push(`Video ${j.item} of ${j.count || '?'}`);
    meta.push(j.stage === 'Starting' ? 'Starting' : fmt);
    if (j.total) meta.push(`${bytes(j.downloaded || 0)} of ${bytes(j.total)}`);
    if (j.speed) meta.push(`${bytes(j.speed)}/s`);
    if (j.eta != null) meta.push(left(j.eta));
  } else if (j.status === 'processing') {
    counter = `${Math.floor(pct * 100)}%`;
    if (j.kind === 'playlist' && j.item) meta.push(`Video ${j.item} of ${j.count || '?'}`);
    meta.push(j.stage || 'Processing');
  } else if (j.status === 'done') {
    meta.push('<span class="okay">Done</span>', fmt);
    if (j.kind === 'playlist' && j.files) meta.push(`${j.files.length} files`);
    if (j.size) meta.push(bytes(j.size));
    if (j.uploader) meta.push(esc(j.uploader));
  } else if (j.status === 'error') meta.push(`<span class="err">${esc(j.error || 'Download failed.')}</span>`);
  else if (j.status === 'canceled') meta.push('Canceled');

  row.querySelector('.jmeta').innerHTML = meta.filter(Boolean).map((m) => (m.startsWith('<span') ? m : `<span>${esc(m)}</span>`)).join('');
  const c = row.querySelector('.counter');
  if (c.textContent !== counter) c.textContent = counter;

  if (statusChanged) {
    const btn = (act, icon, label) => `<button class="icon-btn" data-act="${act}" title="${label}" aria-label="${label}">${ICON[icon]}</button>`;
    let a = '';
    if (j.status === 'queued' || j.status === 'downloading' || j.status === 'processing') a = btn('cancel', 'x', 'Cancel download');
    else if (j.status === 'done') a = (j.kind === 'playlist' ? '' : btn('play', 'play', 'Play')) + btn('show', 'folder', 'Show in folder') + btn('remove', 'trash', 'Remove from list');
    else a = btn('retry', 'retry', 'Try again') + btn('source', 'link', 'Open the page') + btn('remove', 'trash', 'Remove from list');
    row.querySelector('.jactions').innerHTML = a;
  }
}

list.addEventListener('click', async (e) => {
  const li = e.target.closest('.job');
  if (!li) return;
  const j = state.jobs.get(li.dataset.id);
  if (!j) return;
  const act = e.target.closest('[data-act]')?.dataset.act || (e.target.closest('.jthumb') && j.status === 'done' ? (j.kind === 'playlist' ? 'show' : 'play') : null);
  if (!act) return;
  if (act === 'cancel') window.snag.cancel(j.id);
  else if (act === 'retry') window.snag.retry(j.id);
  else if (act === 'source') window.snag.openExternal(j.url);
  else if (act === 'remove') { await window.snag.remove(j.id); state.jobs.delete(j.id); queueRender(j.id); }
  else if (act === 'play' || act === 'show') {
    const ok = act === 'play' ? await window.snag.openFile(j.file) : await window.snag.showFile(j.file || (j.files && j.files[0]));
    if (!ok) toast('That file was moved or deleted.');
  }
});

$('#clearDone').onclick = async () => {
  await window.snag.clearFinished();
  for (const [id, j] of state.jobs) if (['done', 'error', 'canceled'].includes(j.status)) { state.jobs.delete(id); queueRender(id); }
};

window.snag.onJob((j) => {
  const prev = state.jobs.get(j.id);
  state.jobs.set(j.id, j);
  queueRender(j.id);
  if (prev && prev.status !== 'done' && j.status === 'done' && document.hidden === false) toast(`Saved ${j.kind === 'playlist' ? j.title : (j.title || 'video')}`);
});

// ---------- engine + settings ----------
function renderEngine() {
  const e = state.engine;
  const pill = $('#enginePill');
  pill.classList.remove('warn');
  if (e.busy) { pill.hidden = false; pill.textContent = e.busy; }
  else if (e.ready === false) { pill.hidden = false; pill.classList.add('warn'); pill.textContent = 'Engine missing. Open Settings.'; }
  else if (e.ffmpeg === false) { pill.hidden = false; pill.classList.add('warn'); pill.textContent = 'FFmpeg missing. Open Settings.'; }
  else pill.hidden = true;
  $('#engineInfo').textContent = e.ready
    ? `yt-dlp ${e.version || ''}. ${e.ffmpeg ? 'FFmpeg ready.' : 'FFmpeg is missing, so the best video and audio cannot be joined. Install it below.'}`
    : 'The download engine is not installed yet. Check your internet connection and restart Snag.';
  $('#updateEngine').disabled = !!e.busy || !e.ready;
  $('#installFfmpeg').hidden = !e.ready || e.ffmpeg !== false;
  $('#installFfmpeg').disabled = !!e.busy;
}

function renderSettings() {
  const s = state.settings;
  $('#folderPath').textContent = s.folder; $('#folderPath').title = s.folder;
  $('#cookies').value = s.cookies || 'none';
  $('#cookieFileRow').hidden = s.cookies !== 'file';
  $('#cookieFile').textContent = s.cookieFile || 'No file chosen';
  $('#concurrent').value = String(s.concurrent || 3);
  for (const k of ['thumbnail', 'metadata', 'subtitles', 'watchClipboard']) $(`#${k}`).checked = s[k] !== false && !!(s[k] ?? true);
  $('#subtitles').checked = !!s.subtitles;
}

const save = async (patch) => { state.settings = await window.snag.setSettings(patch); renderSettings(); };
$('#cookies').onchange = async (e) => {
  if (e.target.value === 'file' && !state.settings.cookieFile) {
    const f = await window.snag.chooseCookieFile();
    if (!f) { e.target.value = state.settings.cookies || 'none'; return; }
    state.settings.cookieFile = f;
  }
  save({ cookies: e.target.value });
};
$('#chooseCookie').onclick = async () => { const f = await window.snag.chooseCookieFile(); if (f) { state.settings.cookieFile = f; save({ cookies: 'file' }); } };
$('#concurrent').onchange = (e) => save({ concurrent: Number(e.target.value) });
for (const k of ['thumbnail', 'metadata', 'subtitles', 'watchClipboard']) $(`#${k}`).onchange = (e) => save({ [k]: e.target.checked });
$('#chooseFolder').onclick = async () => { const f = await window.snag.chooseFolder(); if (f) { state.settings.folder = f; renderSettings(); toast('New downloads will be saved there'); } };
$('#updateEngine').onclick = async () => { const r = await window.snag.updateEngine(); toast(r.message); };
$('#installFfmpeg').onclick = async () => { const r = await window.snag.installFfmpeg(); toast(r.message); };
$('#openFolder').onclick = () => window.snag.openFolder();

function openSettings() { $('#settings').hidden = false; $('#scrim').hidden = false; $('#closeSettings').focus(); }
function closeSettings() { $('#settings').hidden = true; $('#scrim').hidden = true; $('#openSettings').focus(); }
$('#openSettings').onclick = openSettings;
$('#closeSettings').onclick = closeSettings;
$('#scrim').onclick = closeSettings;

window.snag.onEngine((e) => { state.engine = e; renderEngine(); });

// ---------- app updates ----------
let updateDismissed = null;
let updateAsked = false;

function renderUpdate() {
  const u = state.update || {};
  const bar = $('#update');
  const active = [...state.jobs.values()].some((j) => ['downloading', 'processing', 'queued'].includes(j.status));
  let html = '';
  if (u.state === 'available' && updateDismissed !== u.version) {
    html = `<p>Snag ${esc(u.version)} is available. <span class="sub">You have ${esc(u.current)}.</span></p>
      <button class="link-btn" data-up="later">Later</button><button class="btn primary" data-up="download">Update now</button>`;
  } else if (u.state === 'downloading') {
    html = `<p>Downloading Snag ${esc(u.version || '')} <span class="sub">${Math.floor((u.percent || 0) * 100)}%</span></p><div class="fill"></div>`;
  } else if (u.state === 'ready') {
    html = `<p>Snag ${esc(u.version)} is ready. <span class="sub">Snag restarts to finish${active ? '; downloads in progress will stop' : ''}.</span></p>
      <button class="btn primary" data-up="install">Restart now</button>`;
  } else if (u.state === 'error' && updateAsked) {
    html = `<p class="err">The update did not finish. ${esc((u.error || '').split('\n')[0].slice(0, 140))}</p><button class="btn" data-up="retry">Try again</button>`;
  }
  bar.hidden = !html;
  if (bar.dataset.html !== html.replace(/\d+%/, '')) { bar.innerHTML = html; bar.dataset.html = html.replace(/\d+%/, ''); }
  else if (u.state === 'downloading') bar.querySelector('.sub').textContent = `${Math.floor((u.percent || 0) * 100)}%`;
  const fill = bar.querySelector('.fill');
  if (fill) fill.style.setProperty('--p', (u.percent || 0).toFixed(4));

  const info = {
    checking: 'Checking for updates',
    current: 'You have the latest version.',
    available: `Version ${u.version} is available.`,
    downloading: `Downloading version ${u.version || ''}.`,
    ready: `Version ${u.version} is ready to install.`,
    error: updateAsked ? 'Could not check for updates. Check your internet connection.' : '',
  }[u.state] || '';
  $('#versionInfo').textContent = `Snag ${u.current || ''}. ${info}`.trim();
  $('#checkUpdate').disabled = ['checking', 'downloading'].includes(u.state);
}

$('#update').addEventListener('click', (e) => {
  const act = e.target.closest('[data-up]')?.dataset.up;
  if (act === 'later') { updateDismissed = state.update.version; renderUpdate(); }
  else if (act === 'download' || act === 'retry') { updateAsked = true; window.snag.downloadUpdate(); }
  else if (act === 'install') window.snag.installUpdate();
});
$('#checkUpdate').onclick = () => { updateAsked = true; updateDismissed = null; window.snag.checkUpdate(); };
window.snag.onUpdate((u) => { state.update = u; renderUpdate(); });

(async () => {
  const init = await window.snag.init();
  state.settings = init.settings;
  state.engine = init.engine;
  state.mode = init.settings.mode || 'video';
  state.update = init.update;
  renderUpdate();
  for (const j of init.jobs) { state.jobs.set(j.id, j); queueRender(j.id); }
  updateCounts();
  renderSettings();
  renderEngine();
  input.focus();
})();
