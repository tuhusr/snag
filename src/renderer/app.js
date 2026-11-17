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
const tier = (h) => (h >= 4320 ? ' 8K' : h >= 2160 ? ' 4K' : h >= 1440 ? ' 2K' : '');
const qualityName = (q) => `${q.height}p${q.fps > 30 ? Math.round(q.fps) : ''}${tier(q.height)}${q.hdr ? ' HDR' : ''}`;

// ---------- spec wording ----------
function codecName(c) {
  if (!c) return '';
  const s = c.toLowerCase();
  if (/^(avc|h264)/.test(s)) return 'H.264';
  if (/^(hev|hvc|h265|bytevc1)/.test(s)) return 'HEVC';
  if (/^av01/.test(s)) return 'AV1';
  if (/^vp0?9/.test(s)) return 'VP9';
  if (/^vp0?8/.test(s)) return 'VP8';
  if (/^(mp4a|aac)/.test(s)) return 'AAC';
  if (s === 'opus') return 'Opus';
  if (s === 'vorbis') return 'Vorbis';
  if (s === 'mp3') return 'MP3';
  if (s === 'flac') return 'FLAC';
  if (/^ec-?3/.test(s)) return 'Dolby Digital Plus';
  if (/^ac-?3/.test(s)) return 'Dolby Digital';
  return c.split('.')[0].toUpperCase();
}
const kbpsText = (k) => (!k ? '' : k >= 1000 ? `${(k / 1000).toFixed(k >= 100000 ? 0 : 1)} Mbps` : `${Math.round(k)} kbps`);
const hzText = (hz) => (hz ? `${+(hz / 1000).toFixed(1)} kHz` : '');
const channelText = (n) => ({ 1: 'mono', 2: 'stereo', 6: '5.1 surround', 8: '7.1 surround' }[n] || (n ? `${n} channels` : ''));
const dims = (w, h) => (w && h ? `${w} × ${h}${tier(Math.min(w, h))}` : h ? `${h}p` : '');

// One line of real specs for a finished file (measured average bitrate of the whole file).
function fileSpecs(s, mode) {
  if (!s) return [];
  const out = [];
  if (s.vcodec || s.width) {
    out.push(dims(s.width, s.height));
    out.push([codecName(s.vcodec), s.fps ? `${Math.round(s.fps)} fps` : '', s.hdr || ''].filter(Boolean).join(' '));
    if (s.acodec) out.push(codecName(s.acodec));
  } else if (s.acodec || mode) {
    out.push(codecName(s.acodec) || (mode || '').toUpperCase());
  }
  if (s.bitrate) out.push(`${kbpsText(s.bitrate / 1000)} avg`);
  return out.filter(Boolean);
}
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
    quality = `<label class="sr" for="quality">Quality</label><select id="quality">
      <option value="">Best (${qualityName(p.qualities[0])})</option>
      ${p.qualities.slice(1).map((q) => `<option value="${q.height}" ${state.height === q.height ? 'selected' : ''}>${qualityName(q)}</option>`).join('')}
    </select>`;
  } else if (!isAudio && p.kind === 'playlist') {
    quality = `<label class="sr" for="quality">Quality</label><select id="quality">
      <option value="">Best available</option>${[2160, 1440, 1080, 720, 480, 360].map((h) => `<option value="${h}" ${state.height === h ? 'selected' : ''}>Up to ${h}p</option>`).join('')}
    </select>`;
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
      ${p.specsKey ? '<dl class="specs" id="specs" aria-live="polite"></dl>' : ''}
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
  if (q) q.onchange = () => { state.height = q.value ? Number(q.value) : null; renderSpecs(); };
  $('#startDl').onclick = startDownload;
  $('#startDl').focus();
  renderSpecs();
}

// ---------- spec sheet ----------
const specCache = new Map(); // "key|mode|height" -> specs | Promise

function fetchSpecs(key, mode, height) {
  const id = `${key}|${mode}|${height || 'best'}`;
  if (!specCache.has(id)) specCache.set(id, window.snag.specs(key, mode, height).then((s) => { specCache.set(id, s || false); return s; }));
  return specCache.get(id);
}

async function renderSpecs() {
  const p = state.preview;
  const box = $('#specs');
  if (!p || !p.specsKey || !box) return;
  const audioMode = state.mode === 'mp3' || state.mode === 'm4a';
  const height = audioMode ? null : state.height;
  const id = `${p.specsKey}|${state.mode}|${height || 'best'}`;
  let s = specCache.get(id);
  if (s === undefined || s instanceof Promise) {
    box.classList.add('wait');
    box.innerHTML = `<div><dt>${audioMode ? 'Audio' : 'Video'}</dt><dd>Checking the exact streams</dd></div>`;
    s = await fetchSpecs(p.specsKey, state.mode, height);
    if (state.preview !== p || id !== `${p.specsKey}|${state.mode}|${(audioMode ? null : state.height) || 'best'}`) return; // choice changed meanwhile
  }
  box.classList.remove('wait');
  box.innerHTML = s ? specsHtml(s) : '<div><dt>Specs</dt><dd class="sub">This site does not list stream details. They show on the file once it downloads.</dd></div>';
  if (!audioMode) for (const q of p.qualities || []) fetchSpecs(p.specsKey, state.mode, q.height); // warm the rest quietly
}

function specsHtml(s) {
  const col = (label, lines) => `<div><dt>${label}</dt>${lines.filter(Boolean).map((l, i) => `<dd${i ? ' class="sub"' : ''}>${esc(l)}</dd>`).join('')}</div>`;
  const cols = [];
  const v = s.video, a = s.audio;
  if (v) {
    const rateLine = v.kbps ? `${v.peak ? 'Peak ' : ''}${kbpsText(v.kbps)}` : v.totalKbps ? `${kbpsText(v.totalKbps)} with audio` : '';
    cols.push(col('Video', [dims(v.width, v.height), [codecName(v.codec), v.fps ? `${Math.round(v.fps)} fps` : ''].filter(Boolean).join(', '), rateLine, v.hdr ? `HDR (${v.hdr})` : '']));
  }
  if (a) {
    const src = [codecName(a.codec), a.kbps ? kbpsText(a.kbps) : ''].filter(Boolean).join(', ');
    const detail = [hzText(a.asr), channelText(a.channels)].filter(Boolean).join(', ');
    if (s.convert && s.container === 'MP3') cols.push(col('Audio', [s.convert, src ? `Converted from ${src}` : '', detail]));
    else if (s.convert) cols.push(col('Audio', [`${s.convert} (converted)`, src ? `From ${src}` : '', detail]));
    else cols.push(col('Audio', [src || 'Included', detail || (a.shared ? 'Inside the video stream' : '')]));
  }
  const extras = state.settings.thumbnail !== false ? ', plus cover art' : '';
  const size = s.size ? `${s.sizeExact ? '' : 'About '}${bytes(s.size)}${extras}` : 'Size shows once it starts';
  cols.push(col('File', [s.container, size]));
  return cols.join('');
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
  $('#clearDone').hidden = state.tab !== 'downloads' || !all.some((j) => ['done', 'error', 'canceled'].includes(j.status));
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
    meta.push('<span class="okay">Done</span>');
    const real = fileSpecs(j.specs, j.mode);
    meta.push(...(real.length ? real : [fmt]));
    if (j.kind === 'playlist' && j.files) meta.push(`${j.files.length} files`);
    if (j.size) meta.push(bytes(j.size));
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

// ---------- tabs ----------
state.tab = 'downloads';
function showTab(name, focus = false) {
  state.tab = name;
  for (const [tab, pane, key] of [['#tabDownloads', '#paneDownloads', 'downloads'], ['#tabHistory', '#paneHistory', 'history']]) {
    const on = key === name;
    $(tab).setAttribute('aria-selected', String(on));
    $(tab).tabIndex = on ? 0 : -1;
    $(pane).hidden = !on;
  }
  if (focus) $(name === 'history' ? '#tabHistory' : '#tabDownloads').focus();
  if (name === 'history') loadHistory();
  updateCounts();
  renderHistoryChrome();
}
$('#tabDownloads').onclick = () => showTab('downloads');
$('#tabHistory').onclick = () => showTab('history');
$('.tabs').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); showTab(state.tab === 'downloads' ? 'history' : 'downloads', true); }
});

// ---------- history ----------
const hist = { items: [], loaded: false, query: '', limit: 150 };
const histList = $('#histList');

async function loadHistory() {
  hist.items = await window.snag.library();
  hist.loaded = true;
  renderHistory();
}

function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

function renderHistoryChrome() {
  $('#histCount').textContent = hist.loaded && hist.items.length ? String(hist.items.length) : '';
  $('#clearHistory').hidden = state.tab !== 'history' || !hist.items.length;
}

function renderHistory() {
  renderHistoryChrome();
  const q = hist.query.trim().toLowerCase();
  const match = q ? hist.items.filter((x) => [x.title, x.uploader, siteName(x.site), x.url].some((v) => v && String(v).toLowerCase().includes(q))) : hist.items;
  const shown = match.slice(0, hist.limit);
  const empty = $('#histEmpty');
  empty.hidden = shown.length > 0;
  empty.textContent = hist.items.length ? `Nothing in your history matches "${hist.query.trim()}".` : 'Every video you download is listed here, so you can find it again.';
  $('#histMore').hidden = match.length <= shown.length;
  $('#histMore').textContent = `Show more (${match.length - shown.length} left)`;

  const btn = (act, icon, label) => `<button class="icon-btn" data-act="${act}" title="${label}" aria-label="${label}">${ICON[icon]}</button>`;
  let html = '', day = '';
  for (const x of shown) {
    const label = dayLabel(x.finished);
    if (label !== day) { html += `${day ? '</ul>' : ''}<h3 class="day">${esc(label)}</h3><ul class="jobs">`; day = label; }
    const fmt = `${MODE_NAME[x.mode] || ''}${(x.mode === 'video' || x.mode === 'h264') && x.height ? ` ${x.height}p` : ''}`;
    const real = fileSpecs(x.specs, x.mode);
    const meta = [new Date(x.finished).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), ...(real.length ? real : [fmt]), x.size ? bytes(x.size) : '', x.uploader || siteName(x.site)];
    html += `<li class="job" data-id="${esc(x.id)}" data-status="done">
      <div class="jthumb">${x.thumbnail ? `<img alt="" referrerpolicy="no-referrer" src="${esc(x.thumbnail)}">` : ''}</div>
      <div class="jbody"><div class="jtitle" title="${esc(x.title)}">${esc(x.title)}</div>
        <div class="jmeta">${x.exists ? '' : '<span class="missing">File moved or deleted</span>'}${meta.filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join('')}</div></div>
      <div class="counter"></div>
      <div class="jactions">${x.exists && x.kind !== 'playlist' ? btn('play', 'play', 'Play') : ''}${x.exists ? btn('show', 'folder', 'Show in folder') : ''}${btn('again', 'retry', 'Download again')}${btn('source', 'link', 'Open the page')}${btn('forget', 'trash', 'Remove from history')}</div>
    </li>`;
  }
  histList.innerHTML = html + (day ? '</ul>' : '');
  histList.querySelectorAll('.jthumb img').forEach((img) => { img.onerror = () => img.remove(); });
}

histList.addEventListener('click', async (e) => {
  const li = e.target.closest('.job');
  const x = li && hist.items.find((i) => i.id === li.dataset.id);
  if (!x) return;
  const act = e.target.closest('[data-act]')?.dataset.act || (e.target.closest('.jthumb') && x.exists ? (x.kind === 'playlist' ? 'show' : 'play') : null);
  if (act === 'play' || act === 'show') {
    const ok = act === 'play' ? await window.snag.openFile(x.file) : await window.snag.showFile(x.file || (x.files && x.files[0]));
    if (!ok) { toast('That file was moved or deleted.'); x.exists = false; renderHistory(); }
  } else if (act === 'again') {
    await window.snag.enqueue({ url: x.url, kind: x.kind, mode: x.mode, height: x.height, title: x.title, thumbnail: x.thumbnail, site: x.site, uploader: x.uploader, duration: x.duration, count: x.count });
    toast('Added to downloads');
  } else if (act === 'source') window.snag.openExternal(x.url);
  else if (act === 'forget') {
    await window.snag.libraryRemove(x.id);
    hist.items = hist.items.filter((i) => i.id !== x.id);
    renderHistory();
  }
});

let searchTimer;
$('#histSearch').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { hist.query = e.target.value; hist.limit = 150; renderHistory(); }, 120);
});
$('#histMore').onclick = () => { hist.limit += 150; renderHistory(); };
$('#clearHistory').onclick = async () => {
  if (await window.snag.libraryClear()) { hist.items = []; renderHistory(); toast('History cleared. Your files were not touched.'); }
};
window.snag.onLibraryAdd((x) => {
  hist.items = [x, ...hist.items.filter((i) => i.id !== x.id)];
  if (state.tab === 'history') renderHistory(); else renderHistoryChrome();
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
  loadHistory();
  input.focus();
})();
