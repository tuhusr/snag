'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { settings: {}, engine: {}, jobs: new Map(), preview: null, probeToken: 0, lastClip: '', mode: 'video', height: null };

const MODES = [
  { id: 'video', label: 'MP4', hint: 'Best quality' },
  { id: 'h264', label: 'MP4 H.264', hint: 'Plays on any device' },
  { id: 'mp3', label: 'MP3', hint: 'Audio, plays anywhere' },
  { id: 'm4a', label: 'M4A', hint: 'Audio, original quality' },
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
  more: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/></svg>',
  again: '<svg viewBox="0 0 24 24"><path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5"/><path d="M5 19h14"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  film: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><path d="M10 9.5v5l4.2-2.5z"/></svg>',
};

// Toast. With an action (Undo), it stays 5 s and the action runs only if clicked.
let toastTimer, toastDone = null;
function toast(msg, { action, onAction, onExpire, ms } = {}) {
  const t = $('#toast');
  if (toastDone) { const f = toastDone; toastDone = null; f(); } // settle a previous undo-able toast
  t.replaceChildren(Object.assign(document.createElement('span'), { textContent: msg }));
  if (action) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: action });
    b.onclick = () => { toastDone = null; clearTimeout(toastTimer); t.hidden = true; onAction && onAction(); };
    t.append(b);
    toastDone = onExpire || null;
  }
  t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; if (toastDone) { const f = toastDone; toastDone = null; f(); } }, ms || (action ? 5000 : 2800));
}

// Thumbnails: vertical videos are letterboxed whole instead of cropped into 16:9.
function fitThumb(img) {
  const check = () => { if (img.naturalHeight > img.naturalWidth * 1.05) img.classList.add('portrait'); };
  if (img.complete && img.naturalWidth) check(); else img.addEventListener('load', check, { once: true });
}

// Overflow menu ("More actions"). Items are buttons carrying data-act, so the list's click handler runs them.
let openMenuEl = null;
function closeMenu(focusBack = false) {
  if (!openMenuEl) return;
  const { menu, button } = openMenuEl;
  menu.remove();
  button.setAttribute('aria-expanded', 'false');
  if (focusBack) button.focus();
  openMenuEl = null;
}
function openMenu(button, items) {
  if (openMenuEl && openMenuEl.button === button) return closeMenu(true);
  closeMenu();
  const menu = document.createElement('ul');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items.map((i) => `<li role="none"><button type="button" role="menuitem" data-act="${i.act}"${i.danger ? ' class="danger"' : ''}>${ICON[i.icon] || ''}<span>${esc(i.label)}</span></button></li>`).join('');
  button.parentElement.append(menu);
  button.setAttribute('aria-expanded', 'true');
  openMenuEl = { menu, button };
  const buttons = [...menu.querySelectorAll('button')];
  buttons[0].focus();
  menu.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
  });
}
document.addEventListener('pointerdown', (e) => { if (openMenuEl && !openMenuEl.menu.contains(e.target) && e.target.closest('[data-act="more"]') !== openMenuEl.button) closeMenu(); });

const SIGN_IN = /browser sign-in/i;
const signInButton = (cls = 'btn') => `<button type="button" class="${cls}" data-act="signin">Set up browser sign-in</button>`;

// ---------- link input ----------
const input = $('#url');

function handleText(text, { auto = false } = {}) {
  const urls = urlsIn(text);
  if (!urls.length) {
    if (!auto) showNotice('That does not look like a link. Copy the address of the video page and paste it here.');
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
  if (e.key === 'Escape') {
    if (openMenuEl) closeMenu(true);
    else if (!$('#settings').hidden) closeSettings();
    else if (!preview.hidden) { ++state.probeToken; hidePreview(); input.value = ''; input.focus(); }
    return;
  }
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

function showNotice(msg, retry) {
  preview.hidden = false;
  preview.innerHTML = `<div class="notice" role="alert"><p>${esc(msg)}</p><div class="actions">${SIGN_IN.test(msg) ? signInButton() : ''}${retry ? '<button class="btn" data-act="retry-probe">Try again</button>' : ''}</div></div>`;
  if (retry) preview.querySelector('[data-act="retry-probe"]').onclick = () => probe(retry);
  const s = preview.querySelector('[data-act="signin"]');
  if (s) s.onclick = () => openSettings('cookies');
}

async function probe(url) {
  const token = ++state.probeToken;
  state.preview = null;
  preview.hidden = false;
  preview.innerHTML = `<div class="card skeleton loading"><div class="thumb"></div><div class="card-body"><div class="line"></div><div class="line"></div><p class="facts">Reading ${esc(new URL(url).hostname.replace(/^www\./, ''))}</p></div></div>`;
  preview.querySelectorAll('.line').forEach((l, i) => { l.style.width = i ? '40%' : '80%'; });
  const r = await window.snag.probe(url);
  if (token !== state.probeToken) return;
  if (r.error) return showNotice(r.error, url);
  state.preview = r;
  // Keep the last quality picked, if this video has it; otherwise Best.
  const want = Number(state.settings.height) || null;
  state.height = want && (r.kind === 'playlist' || (r.qualities || []).some((q) => q.height === want)) ? want : null;
  if (!r.hasVideo && (state.mode === 'video' || state.mode === 'h264')) state.mode = 'mp3';
  renderPreview(true);
}

function setMode(mode) {
  state.mode = mode;
  save({ mode });
  renderPreview();
  preview.querySelector(`[data-mode="${mode}"]`)?.focus();
}

function renderPreview(first = false) {
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
      ${p.specsKey ? '<dl class="specs" id="specs" aria-live="polite"></dl><p class="spec-note" id="specNote" hidden></p>' : ''}
    </div>
  </div>`;

  const img = preview.querySelector('img.thumb');
  if (img) { img.onerror = () => { img.replaceWith(Object.assign(document.createElement('div'), { className: 'thumb' })); }; fitThumb(img); }
  preview.querySelectorAll('.mode').forEach((b) => b.onclick = () => setMode(b.dataset.mode));
  const q = $('#quality');
  if (q) q.onchange = () => { state.height = q.value ? Number(q.value) : null; save({ height: state.height }); renderSpecs(); };
  $('#startDl').onclick = startDownload;
  if (first) $('#startDl').focus(); // only when the video first appears, never while choosing
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
  // Not every player opens VP9/AV1/HEVC; say so, with the one-click way out.
  const note = $('#specNote');
  const codec = s && s.video ? codecName(s.video.codec) : '';
  if (note) {
    note.hidden = !(state.mode === 'video' && codec && codec !== 'H.264');
    if (!note.hidden) {
      const where = {
        VP9: 'VP9 plays in browsers and VLC. For TVs, phones and video editors, choose',
        AV1: 'AV1 plays in browsers and VLC on newer PCs. For TVs, older phones and video editors, choose',
        HEVC: 'HEVC plays on phones and in VLC, but Windows may need the HEVC extension. For the widest support, choose',
      }[codec] || `${codec} may not play everywhere. For the widest support, choose`;
      note.innerHTML = `${esc(where)} <button type="button" class="link-btn inline" id="toH264">MP4 H.264</button>.`;
      $('#toH264').onclick = () => setMode('h264');
    }
  }
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
  if (!all.length) {
    const has = typeof hist !== 'undefined' && hist.items.length > 0;
    $('#emptyTitle').textContent = has ? 'Nothing downloading' : 'Nothing downloading yet';
    $('#emptyText').innerHTML = has
      ? 'Everything you have saved is in <button type="button" class="link-btn inline" id="toHistory">History</button>. Paste a new link above to start another.'
      : `${state.settings.watchClipboard !== false ? 'Copy a video link in your browser and come back: Snag fills it in. ' : ''}You can also press <kbd>Ctrl</kbd>+<kbd>V</kbd> anywhere in this window, or drag a link onto it.`;
    const h = $('#toHistory');
    if (h) h.onclick = () => showTab('history', true);
  }
  $('#clearDone').hidden = state.tab !== 'downloads' || !all.some((j) => ['done', 'error', 'canceled'].includes(j.status));
  document.title = active ? `Snag (${active})` : 'Snag';
}

function rowFor(j) {
  let li = rows.get(j.id);
  if (li) return li;
  li = document.createElement('li');
  li.className = 'job';
  li.dataset.id = j.id;
  li.innerHTML = `<div class="fill" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100"></div><div class="jthumb">${ICON.film}</div><div class="jbody"><div class="jtitle"></div><div class="jmeta"></div></div><div class="counter"></div><div class="jactions"></div>`;
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
    img.onerror = () => { img.remove(); slot.innerHTML = ICON.film; };
    fitThumb(img);
    slot.replaceChildren(img);
  }

  const title = j.kind === 'playlist' ? j.title : (j.title && j.title !== j.url ? j.title : j.itemTitle || j.title);
  const tEl = row.querySelector('.jtitle');
  if (tEl.textContent !== title) { tEl.textContent = title; tEl.title = title; }

  const pct = Math.max(0, Math.min(1, j.percent || 0));
  const fill = row.querySelector('.fill');
  fill.style.setProperty('--p', pct.toFixed(4));
  fill.setAttribute('aria-valuenow', String(Math.floor(pct * 100)));

  // Meta: specs read darker than context so the line splits into two groups at a glance.
  const meta = [];
  const add = (t, cls = '') => t && meta.push(`<span${cls ? ` class="${cls}"` : ''}>${esc(t)}</span>`);
  const fmt = `${MODE_NAME[j.mode] || ''}${(j.mode === 'video' || j.mode === 'h264') && j.height ? ` ${j.height}p` : ''}`;
  let counter = '';
  if (j.status === 'queued') { add('Waiting'); add(fmt); }
  else if (j.status === 'downloading') {
    counter = `${Math.floor(pct * 100)}%`;
    if (j.kind === 'playlist' && j.item) add(`Video ${j.item} of ${j.count || '?'}`);
    add(j.stage === 'Starting' ? 'Starting' : fmt);
    if (j.total) add(`${bytes(j.downloaded || 0)} of ${bytes(j.total)}`, 'spec');
    if (j.speed) add(`${bytes(j.speed)}/s`, 'spec');
    if (j.eta != null) add(left(j.eta));
  } else if (j.status === 'processing') {
    counter = `${Math.floor(pct * 100)}%`;
    if (j.kind === 'playlist' && j.item) add(`Video ${j.item} of ${j.count || '?'}`);
    add(j.stage || 'Processing');
  } else if (j.status === 'done') {
    add('Done', 'okay');
    const real = fileSpecs(j.specs, j.mode);
    (real.length ? real : [fmt]).forEach((t) => add(t, 'spec'));
    if (j.kind === 'playlist' && j.files) add(`${j.files.length} files`, 'spec');
    if (j.size) add(bytes(j.size), 'spec');
  } else if (j.status === 'error') {
    meta.push(`<span class="err">${esc(j.error || 'Download failed.')}</span>`);
    if (SIGN_IN.test(j.error || '')) meta.push(signInButton('link-btn inline err-act'));
  } else if (j.status === 'canceled') add('Canceled');

  row.querySelector('.jmeta').innerHTML = meta.join('');
  const c = row.querySelector('.counter');
  const justDone = statusChanged && j.status === 'done' && ['downloading', 'processing'].includes(row.dataset.was);
  if (justDone) {
    // The finish moment: the percentage resolves into a verified "Saved", then gets out of the way.
    c.className = 'counter saved';
    c.innerHTML = `${ICON.check}<span>Saved</span>`;
    setTimeout(() => { if (c.classList.contains('saved')) { c.className = 'counter'; c.textContent = ''; } }, 2700);
  } else if (!c.classList.contains('saved') && c.textContent !== counter) c.textContent = counter;
  row.dataset.was = j.status;

  if (statusChanged || row.dataset.confirm !== (row.confirming ? '1' : '')) {
    row.dataset.confirm = row.confirming ? '1' : '';
    const btn = (act, icon, label) => `<button class="icon-btn" data-act="${act}" title="${label}" aria-label="${label}">${ICON[icon]}</button>`;
    const more = '<button class="icon-btn" data-act="more" title="More actions" aria-label="More actions" aria-haspopup="menu" aria-expanded="false">' + ICON.more + '</button>';
    let a = '';
    if (['queued', 'downloading', 'processing'].includes(j.status)) {
      a = row.confirming ? '<button class="confirm-stop" data-act="cancel-confirm">Stop download</button>' : btn('cancel', 'x', 'Cancel download');
    } else if (j.status === 'done') a = (j.kind === 'playlist' ? '' : btn('play', 'play', 'Play')) + btn('show', 'folder', 'Show in folder') + more;
    else a = btn('retry', 'retry', 'Try again') + more;
    row.querySelector('.jactions').innerHTML = a;
  }
}

// Removing from Downloads waits 5 s so Undo can bring the row back.
function removeJobWithUndo(j) {
  state.jobs.delete(j.id);
  queueRender(j.id);
  toast('Removed from Downloads', {
    action: 'Undo',
    onAction: () => { state.jobs.set(j.id, j); const r = rows.get(j.id); if (r) r.dataset.status = ''; queueRender(j.id); },
    onExpire: () => window.snag.remove(j.id),
  });
}

list.addEventListener('click', async (e) => {
  const li = e.target.closest('.job');
  if (!li) return;
  const j = state.jobs.get(li.dataset.id);
  if (!j) return;
  const btnEl = e.target.closest('[data-act]');
  const act = btnEl?.dataset.act || (e.target.closest('.jthumb') && j.status === 'done' ? (j.kind === 'playlist' ? 'show' : 'play') : null);
  if (!act) return;
  if (act !== 'more') closeMenu();
  if (act === 'cancel') {
    // A long download is one click from being thrown away: past a quarter, ask once.
    if ((j.percent || 0) > 0.25) {
      li.confirming = true; queueRender(j.id);
      setTimeout(() => { li.confirming = false; queueRender(j.id); }, 3500);
      requestAnimationFrame(() => requestAnimationFrame(() => li.querySelector('[data-act="cancel-confirm"]')?.focus()));
    } else window.snag.cancel(j.id);
  } else if (act === 'cancel-confirm') { li.confirming = false; window.snag.cancel(j.id); }
  else if (act === 'more') {
    openMenu(btnEl, [{ act: 'source', icon: 'link', label: 'Open the page' }, { act: 'remove', icon: 'trash', label: 'Remove from list', danger: true }]);
  }
  else if (act === 'retry') window.snag.retry(j.id);
  else if (act === 'signin') openSettings('cookies');
  else if (act === 'source') window.snag.openExternal(j.url);
  else if (act === 'remove') removeJobWithUndo(j);
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
  // The supported-sites line is for first-timers; it retires once something has been saved.
  $('#hint').hidden = hist.items.length > 0;
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
  const more = `<button class="icon-btn" data-act="more" title="More actions" aria-label="More actions" aria-haspopup="menu" aria-expanded="false">${ICON.more}</button>`;
  let html = '', day = '';
  for (const x of shown) {
    const label = dayLabel(x.finished);
    if (label !== day) { html += `${day ? '</ul>' : ''}<h3 class="day">${esc(label)}</h3><ul class="jobs">`; day = label; }
    const fmt = `${MODE_NAME[x.mode] || ''}${(x.mode === 'video' || x.mode === 'h264') && x.height ? ` ${x.height}p` : ''}`;
    const real = fileSpecs(x.specs, x.mode);
    const span = (t, cls = '') => (t ? `<span${cls ? ` class="${cls}"` : ''}>${esc(t)}</span>` : '');
    const meta = (x.exists ? '' : span('File moved or deleted', 'missing'))
      + span(new Date(x.finished).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))
      + (real.length ? real : [fmt]).map((t) => span(t, 'spec')).join('')
      + span(x.size ? bytes(x.size) : '', 'spec')
      + span(x.uploader || siteName(x.site));
    const open = x.exists ? (x.kind === 'playlist' ? 'show' : 'play') : '';
    html += `<li class="job${open ? ' openable' : ' gone'}" data-id="${esc(x.id)}" data-status="done"${open ? ` tabindex="0" aria-label="${open === 'play' ? 'Play' : 'Show'} ${esc(x.title)}"` : ''}>
      <div class="jthumb">${x.thumbnail ? `<img alt="" referrerpolicy="no-referrer" src="${esc(x.thumbnail)}">` : ICON.film}</div>
      <div class="jbody"><div class="jtitle" title="${esc(x.title)}">${esc(x.title)}</div><div class="jmeta">${meta}</div></div>
      <div class="jactions">${x.exists && x.kind !== 'playlist' ? btn('play', 'play', 'Play') : ''}${x.exists ? btn('show', 'folder', 'Show in folder') : btn('again', 'again', 'Download again')}${more}</div>
    </li>`;
  }
  histList.innerHTML = html + (day ? '</ul>' : '');
  histList.querySelectorAll('.jthumb img').forEach((img) => {
    img.onerror = () => { const s = img.parentElement; img.remove(); s.innerHTML = ICON.film; };
    fitThumb(img);
  });
}

function forgetWithUndo(x) {
  const at = hist.items.findIndex((i) => i.id === x.id);
  hist.items = hist.items.filter((i) => i.id !== x.id);
  renderHistory();
  toast('Removed from History', {
    action: 'Undo',
    onAction: () => { hist.items.splice(Math.max(0, at), 0, x); renderHistory(); },
    onExpire: () => window.snag.libraryRemove(x.id),
  });
}

async function historyAct(x, act, btnEl) {
  if (act !== 'more') closeMenu();
  if (act === 'play' || act === 'show') {
    const ok = act === 'play' ? await window.snag.openFile(x.file) : await window.snag.showFile(x.file || (x.files && x.files[0]));
    if (!ok) { toast('That file was moved or deleted.'); x.exists = false; renderHistory(); }
  } else if (act === 'more') {
    openMenu(btnEl, [
      ...(x.exists ? [{ act: 'again', icon: 'again', label: 'Download again' }] : []),
      { act: 'source', icon: 'link', label: 'Open the page' },
      { act: 'forget', icon: 'trash', label: 'Remove from History', danger: true },
    ]);
  } else if (act === 'again') {
    await window.snag.enqueue({ url: x.url, kind: x.kind, mode: x.mode, height: x.height, title: x.title, thumbnail: x.thumbnail, site: x.site, uploader: x.uploader, duration: x.duration, count: x.count });
    toast('Added to Downloads');
  } else if (act === 'source') window.snag.openExternal(x.url);
  else if (act === 'forget') forgetWithUndo(x);
}

histList.addEventListener('click', (e) => {
  const li = e.target.closest('.job');
  const x = li && hist.items.find((i) => i.id === li.dataset.id);
  if (!x) return;
  const btnEl = e.target.closest('[data-act]');
  if (btnEl) return historyAct(x, btnEl.dataset.act, btnEl);
  if (e.target.closest('.jactions, .menu')) return;
  if (li.classList.contains('openable')) historyAct(x, x.kind === 'playlist' ? 'show' : 'play'); // the whole row opens the file
});
histList.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.matches('.job.openable')) return;
  const x = hist.items.find((i) => i.id === e.target.dataset.id);
  if (x) historyAct(x, x.kind === 'playlist' ? 'show' : 'play');
});

let searchTimer;
$('#histSearch').addEventListener('input', (e) => {
  $('#histClear').hidden = !e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { hist.query = e.target.value; hist.limit = 150; renderHistory(); }, 120);
});
$('#histSearch').addEventListener('keydown', (e) => { if (e.key === 'Escape' && e.target.value) { e.stopPropagation(); $('#histClear').click(); } });
$('#histClear').onclick = () => { const s = $('#histSearch'); s.value = ''; $('#histClear').hidden = true; hist.query = ''; renderHistory(); s.focus(); };
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
  $('#theme').value = s.theme || 'time';
  $('#themeHelp').textContent = {
    time: 'Light from 7:00 AM to 4:59 PM, dark from 5:00 PM to 6:59 AM, by your PC’s clock.',
    system: 'Follows the light or dark setting in Windows.',
  }[s.theme || 'time'] || '';
  $('#themeHelp').hidden = !$('#themeHelp').textContent;
  for (const k of ['thumbnail', 'metadata', 'subtitles', 'watchClipboard']) $(`#${k}`).checked = s[k] !== false && !!(s[k] ?? true);
  $('#subtitles').checked = !!s.subtitles;
}

const save = async (patch) => { state.settings = await window.snag.setSettings(patch); renderSettings(); updateCounts(); };
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
$('#theme').onchange = (e) => save({ theme: e.target.value });
for (const k of ['thumbnail', 'metadata', 'subtitles', 'watchClipboard']) $(`#${k}`).onchange = (e) => save({ [k]: e.target.checked });
$('#chooseFolder').onclick = async () => { const f = await window.snag.chooseFolder(); if (f) { state.settings.folder = f; renderSettings(); toast('New downloads will be saved there'); } };
$('#updateEngine').onclick = async () => { const r = await window.snag.updateEngine(); toast(r.message); };
$('#installFfmpeg').onclick = async () => { const r = await window.snag.installFfmpeg(); toast(r.message); };
$('#openFolder').onclick = () => window.snag.openFolder();

// Settings is a modal dialog: everything behind it is inert, so Tab stays inside.
let settingsReturn = null;
function openSettings(focusField) {
  closeMenu();
  settingsReturn = document.activeElement;
  $('#settings').hidden = false; $('#scrim').hidden = false;
  $('.wrap').inert = true; $('.bar-actions').inert = true;
  if (focusField && $(`#${focusField}`)) {
    const el = $(`#${focusField}`);
    const field = el.closest('.field');
    field.scrollIntoView({ block: 'center' });
    field.classList.remove('flash'); void field.offsetWidth; field.classList.add('flash');
    el.focus();
  } else $('#closeSettings').focus();
}
function closeSettings() {
  $('#settings').hidden = true; $('#scrim').hidden = true;
  $('.wrap').inert = false; $('.bar-actions').inert = false;
  (settingsReturn && document.contains(settingsReturn) ? settingsReturn : $('#openSettings')).focus();
}
$('#openSettings').onclick = () => openSettings();
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
      <button class="link-btn" data-up="later">Later</button><button class="btn" data-up="download">Update now</button>`;
  } else if (u.state === 'downloading') {
    html = `<p>Downloading Snag ${esc(u.version || '')} <span class="sub">${Math.floor((u.percent || 0) * 100)}%</span></p><div class="fill"></div>`;
  } else if (u.state === 'ready') {
    html = `<p>Snag ${esc(u.version)} is ready. <span class="sub">Snag restarts to finish${active ? '; downloads in progress will stop' : ''}.</span></p>
      <button class="btn" data-up="install">Restart now</button>`;
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
  // The title-bar icons line up with the content column's right edge; account for the scrollbar gutter.
  const wrap = $('.wrap');
  document.documentElement.style.setProperty('--gutter', `${wrap.offsetWidth - wrap.clientWidth}px`);
  input.focus();
})();
