// yt-dlp wrapper: finds/installs the engine, probes links, runs downloads with live progress.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
// yt-dlp's own FFmpeg builds, patched for the problems yt-dlp hits with stock FFmpeg.
const FFMPEG_URL = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
const MARK = 'SNAG|';

const STAGES = {
  Merger: 'Merging video and audio',
  FFmpegMerger: 'Merging video and audio',
  FFmpegVideoRemuxer: 'Packing into MP4',
  FFmpegVideoConvertor: 'Converting to MP4',
  FFmpegExtractAudio: 'Converting audio',
  EmbedThumbnail: 'Adding cover art',
  FFmpegThumbnailsConvertor: 'Preparing cover art',
  FFmpegSubtitlesConvertor: 'Preparing subtitles',
  FFmpegConcat: 'Joining parts',
  FFmpegCopyStream: 'Packing file',
  FFmpegEmbedSubtitle: 'Adding subtitles',
  FFmpegMetadata: 'Adding title and chapters',
  FFmpegFixupM3u8: 'Fixing stream',
  FFmpegFixupM4a: 'Fixing audio',
  FFmpegFixupStretched: 'Fixing aspect ratio',
  FFmpegFixupDuplicateMoov: 'Fixing file',
  MoveFiles: 'Finishing',
};

function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8', ...opts },
      (err, stdout, stderr) => resolve({ err, stdout: stdout || '', stderr: stderr || '' }));
  });
}

function fetchToFile(url, dest, onProgress = null, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 8) return reject(new Error('Too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'Snag' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchToFile(new URL(res.headers.location, url).toString(), dest, onProgress, hops + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const total = Number(res.headers['content-length']) || 0;
      let got = 0;
      if (onProgress && total) res.on('data', (c) => { got += c.length; onProgress(got / total); });
      const tmp = dest + '.download';
      const out = fs.createWriteStream(tmp);
      res.on('error', reject);
      res.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); resolve(dest); }));
      out.on('error', reject);
    }).on('error', reject);
  });
}

// Turn yt-dlp's raw error text into something a person can act on.
function explain(raw) {
  const m = raw || '';
  if (/sign in to confirm|confirm you.?re not a bot/i.test(m)) return 'YouTube wants a signed-in browser. Turn on "Use browser sign-in" in Settings and try again.';
  if (/login required|log in|rate-limit|private|cookies/i.test(m) && /instagram|facebook|tiktok|twitter|x\.com/i.test(m)) return 'This site needs you signed in. Turn on "Use browser sign-in" in Settings and try again.';
  if (/login required|logged.in|requires authentication|members-only|private video|--cookies-from-browser/i.test(m)) return 'This video needs a signed-in account. Turn on "Use browser sign-in" in Settings and try again.';
  if (/could not copy .*cookie|failed to decrypt|cookie database/i.test(m)) return 'Could not read sign-in from that browser. Close the browser fully and try again, or pick Firefox in Settings.';
  if (/unsupported url/i.test(m)) return 'This link is not a video page Snag can read. Open the video itself and copy its link.';
  if (/video unavailable|has been removed|does not exist|404/i.test(m)) return 'The video is unavailable. It may be deleted, private, or blocked in your region.';
  if (/ffmpeg/i.test(m) && /not found|not installed/i.test(m)) return 'FFmpeg is missing, so video and audio cannot be merged. Install it from Settings.';
  if (/geo|not available in your country/i.test(m)) return 'This video is blocked in your region.';
  if (/HTTP Error 403/i.test(m)) return 'The site refused the download (403). Update the engine in Settings and try again.';
  return m.replace(/^ERROR:\s*/i, '').replace(/^\[[^\]]+\]\s*[\w-]+:\s*/, '').trim() || 'Download failed.';
}

class Engine {
  constructor(binDir) {
    this.binDir = binDir;
    this.ytdlp = null;
    this.ffmpegDir = null;
    this.version = null;
  }

  managedPath() { return path.join(this.binDir, 'yt-dlp.exe'); }

  async which(name) {
    const r = await run('where', [name]);
    const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first && fs.existsSync(first) ? first : null;
  }

  // Make sure yt-dlp and ffmpeg are available. Reports progress through onStatus(text).
  async ensure(onStatus = () => {}) {
    fs.mkdirSync(this.binDir, { recursive: true });
    const managed = this.managedPath();
    if (!fs.existsSync(managed)) {
      onStatus('Installing the download engine');
      try { await fetchToFile(YTDLP_URL, managed); } catch (e) { /* fall back to a system copy below */ }
    }
    this.ytdlp = fs.existsSync(managed) ? managed : await this.which('yt-dlp');

    const localFf = path.join(this.binDir, 'ffmpeg.exe');
    const ff = fs.existsSync(localFf) ? localFf : await this.which('ffmpeg');
    this.ffmpegDir = ff ? path.dirname(ff) : null;
    if (!this.ffmpegDir) await this.installFfmpeg(onStatus);

    if (this.ytdlp) {
      const r = await run(this.ytdlp, ['--version']);
      this.version = r.stdout.trim() || null;
    }
    return this.status();
  }

  // Download FFmpeg + FFprobe into binDir. Needed to merge best video with best audio.
  async installFfmpeg(onStatus = () => {}) {
    fs.mkdirSync(this.binDir, { recursive: true });
    const zip = path.join(this.binDir, 'ffmpeg.zip');
    let last = -1;
    onStatus('Installing FFmpeg');
    try {
      await fetchToFile(FFMPEG_URL, zip, (p) => {
        const pct = Math.floor(p * 100);
        if (pct !== last) { last = pct; onStatus(`Installing FFmpeg ${pct}%`); }
      });
      onStatus('Unpacking FFmpeg');
      // Windows' built-in bsdtar reads zip files; Git's GNU tar on PATH does not, so call it by full path.
      const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      const r = await run(tar, ['-xf', zip, '-C', this.binDir, '--strip-components', '2', '*/bin/ffmpeg.exe', '*/bin/ffprobe.exe']);
      if (r.err) throw new Error(r.stderr.trim() || 'Could not unpack FFmpeg');
    } catch (e) {
      this.ffmpegError = e.message;
    } finally {
      for (const f of [zip, `${zip}.download`]) { try { fs.unlinkSync(f); } catch {} }
    }
    if (fs.existsSync(path.join(this.binDir, 'ffmpeg.exe'))) { this.ffmpegDir = this.binDir; this.ffmpegError = null; }
    return !!this.ffmpegDir;
  }

  status() {
    return { ready: !!this.ytdlp, version: this.version, ffmpeg: !!this.ffmpegDir, managed: this.ytdlp === this.managedPath() };
  }

  async update() {
    if (!this.ytdlp) return { ok: false, message: 'Engine is not installed.' };
    const r = await run(this.ytdlp, ['-U']);
    const v = await run(this.ytdlp, ['--version']);
    this.version = v.stdout.trim() || this.version;
    const text = (r.stdout + r.stderr).trim();
    const ok = !r.err || /up to date|updated/i.test(text);
    return { ok, version: this.version, message: /up to date/i.test(text) ? 'Already up to date' : ok ? `Updated to ${this.version}` : explain(text.split('\n').pop()) };
  }

  authArgs(s) {
    if (!s || !s.cookies || s.cookies === 'none') return [];
    if (s.cookies === 'file') return s.cookieFile ? ['--cookies', s.cookieFile] : [];
    return ['--cookies-from-browser', s.cookies];
  }

  baseArgs(settings) {
    const a = ['--encoding', 'utf-8', '--no-colors', '--ignore-config'];
    if (this.ffmpegDir) a.push('--ffmpeg-location', this.ffmpegDir);
    return a.concat(this.authArgs(settings));
  }

  env() { return { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }; }

  async probe(url, settings) {
    const args = [...this.baseArgs(settings), '-J', '--flat-playlist', '--no-playlist', '--no-warnings', '--', url];
    const r = await run(this.ytdlp, args, { env: this.env() });
    const failure = () => {
      const line = r.stderr.split(/\r?\n/).filter((l) => /ERROR/i.test(l)).pop() || r.stderr.trim().split('\n').pop();
      return { error: line ? explain(line) : 'Could not read the video details.' };
    };
    let info = null;
    try { info = JSON.parse(r.stdout); } catch {}
    if (!info || typeof info !== 'object') return failure();
    return summarize(info, url);
  }

  // job: { url, mode: 'video'|'h264'|'mp3'|'m4a', height, folder, kind }
  download(job, settings, onUpdate) {
    const video = job.mode === 'video' || job.mode === 'h264';
    const res = job.height ? `res:${job.height}` : 'res';
    const fmt = {
      video: ['-f', 'bv*+ba/b', '-S', `${res},fps,hdr:12,vbr,abr,asr`, '--merge-output-format', 'mp4', '--remux-video', 'mp4'],
      h264: ['-f', 'bv*+ba/b', '-S', `vcodec:h264,${res},fps,acodec:aac,vbr,abr`, '--merge-output-format', 'mp4', '--remux-video', 'mp4'],
      mp3: ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0'],
      m4a: ['-f', 'ba[ext=m4a]/ba/b', '-x', '--audio-format', 'm4a', '--audio-quality', '0'],
    }[job.mode];

    const out = job.kind === 'playlist'
      ? '%(playlist_title,playlist_id).120B/%(playlist_index)03d %(title).160B.%(ext)s'
      : '%(title).180B.%(ext)s';

    const args = [
      ...this.baseArgs(settings),
      '--newline', '--progress', '--no-simulate', '--no-mtime', '--windows-filenames',
      '-N', String(settings.fragments || 4),
      '-P', job.folder, '-P', `temp:${path.join(job.folder, '.snag-temp')}`, '-o', out,
      '--progress-template', `download:${MARK}DL|%(info.format_id)s|%(progress)j`,
      '--progress-template', `postprocess:${MARK}PP|%(progress.postprocessor)s|%(progress.status)s`,
      '--print', `video:${MARK}ITEM|%(playlist_index|)s|%(n_entries,playlist_count|)s|%(filesize,filesize_approx|0)s|%(height|)s|%(title)s`,
      '--print', `after_move:${MARK}FILE|%(filepath)s`,
      ...fmt,
      ...(settings.metadata !== false ? ['--embed-metadata', '--embed-chapters'] : []),
      ...(settings.thumbnail !== false ? ['--embed-thumbnail'] : []),
      ...(video && settings.subtitles ? ['--embed-subs', '--sub-langs', 'en.*,-live_chat'] : []),
      job.kind === 'playlist' ? '--yes-playlist' : '--no-playlist',
      '--', job.url,
    ];

    const child = spawn(this.ytdlp, args, { windowsHide: true, env: this.env() });
    const st = { percent: 0, speed: null, eta: null, item: null, count: null, title: null, height: null, files: [], parts: new Set(), errors: [] };
    let expected = 0, doneBytes = 0, cur = { fmt: null, got: 0, total: 0 }, itemPct = 0;
    let canceled = false;

    const emit = (patch) => onUpdate({ ...patch, item: st.item, count: st.count, itemTitle: st.title, height: st.height });
    const overall = (p) => (st.count && st.item ? ((st.item - 1) + p) / st.count : p);

    const onLine = (line) => {
      if (!line.startsWith(MARK)) {
        if (/^ERROR:/i.test(line)) st.errors.push(line);
        return;
      }
      const [, kind, ...rest] = line.split('|');
      if (kind === 'ITEM') {
        const [idx, n, size, h, ...t] = rest;
        st.item = Number(idx) || null; st.count = Number(n) || null;
        st.height = Number(h) || null; st.title = t.join('|');
        expected = Number(size) || 0; doneBytes = 0; cur = { fmt: null, got: 0, total: 0 }; itemPct = 0;
        emit({ status: 'downloading', percent: overall(0), stage: 'Starting', total: expected || null });
      } else if (kind === 'DL') {
        const fmtId = rest[0];
        let p; try { p = JSON.parse(rest.slice(1).join('|')); } catch { return; }
        if (p.filename) st.parts.add(p.filename);
        if (p.status === 'downloading') {
          if (cur.fmt !== fmtId) cur = { fmt: fmtId, got: 0, total: 0 };
          cur.got = p.downloaded_bytes || 0;
          cur.total = p.total_bytes || p.total_bytes_estimate || 0;
        } else if (p.status === 'finished') {
          doneBytes += p.total_bytes || p.downloaded_bytes || cur.got;
          cur = { fmt: null, got: 0, total: 0 };
        }
        const got = doneBytes + cur.got;
        const denom = Math.max(expected, doneBytes + cur.total, got);
        if (denom) itemPct = Math.max(itemPct, Math.min(1, got / denom));
        emit({ status: 'downloading', stage: 'Downloading', percent: overall(itemPct), speed: p.speed || null, eta: p.eta ?? null, downloaded: got, total: denom || null });
      } else if (kind === 'PP') {
        const name = rest[0];
        if (rest[1] === 'started') emit({ status: 'processing', stage: STAGES[name] || 'Processing', percent: overall(1), speed: null, eta: null });
      } else if (kind === 'FILE') {
        st.files.push(rest.join('|'));
      }
    };

    const pipe = (stream) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
      });
      stream.on('end', () => { if (buf) onLine(buf); });
    };
    pipe(child.stdout); pipe(child.stderr);

    child.on('close', (code) => {
      const tempDir = path.join(job.folder, '.snag-temp');
      try { fs.rmdirSync(tempDir); } catch {}
      if (canceled) {
        cleanup(st.parts, tempDir);
        return onUpdate({ status: 'canceled', speed: null, eta: null });
      }
      if (code === 0 || (st.files.length && !st.errors.length)) {
        let size = null;
        try { size = st.files.reduce((n, f) => n + fs.statSync(f).size, 0); } catch {}
        return onUpdate({ status: 'done', percent: 1, speed: null, eta: null, file: st.files[st.files.length - 1] || null, files: st.files, size, stage: null });
      }
      onUpdate({ status: 'error', speed: null, eta: null, error: explain(st.errors.pop() || `Engine stopped (code ${code}).`) });
    });
    child.on('error', (e) => onUpdate({ status: 'error', error: e.message }));

    onUpdate({ status: 'downloading', stage: 'Starting', percent: 0 });

    return {
      cancel() {
        canceled = true;
        if (child.pid) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      },
    };
  }
}

// Remove everything a canceled download left behind: partial streams, fragments, cover art.
function cleanup(parts, tempDir) {
  setTimeout(() => {
    for (const f of parts) {
      const dir = path.dirname(f);
      const stem = path.basename(f).replace(/(\.f[\w-]+)?\.\w+$/, '');
      try {
        for (const n of fs.readdirSync(dir)) if (n.startsWith(`${stem}.`)) { try { fs.unlinkSync(path.join(dir, n)); } catch {} }
      } catch {}
    }
    try { fs.rmdirSync(tempDir); } catch {}
  }, 600);
}

function bestThumb(info) {
  if (info.thumbnail) return info.thumbnail;
  const t = (info.thumbnails || []).filter((x) => x.url);
  return t.length ? t[t.length - 1].url : (info.entries && info.entries[0] && bestThumb(info.entries[0])) || null;
}

function summarize(info, url) {
  const site = info.extractor_key || info.ie_key || info.extractor || '';
  if (info._type === 'playlist') {
    return {
      kind: 'playlist', url: info.webpage_url || url, title: info.title || 'Playlist', site,
      uploader: info.uploader || info.channel || null, count: (info.entries || []).length || info.playlist_count || null,
      thumbnail: bestThumb(info),
    };
  }
  const formats = info.formats || [];
  const vids = formats.filter((f) => f.vcodec !== 'none' && f.height);
  const auds = formats.filter((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none');
  const dur = info.duration || 0;
  const rate = (f) => f.vbr || f.tbr || 0;
  // Only exact sizes are shown: streaming (m3u8) bitrates are nominal and can be off by 2-3x.
  const topAudio = auds.reduce((m, f) => ((f.abr || f.tbr || 0) > (m ? m.abr || m.tbr || 0 : -1) ? f : m), null);
  const audioSize = topAudio ? topAudio.filesize || 0 : 0;

  const byHeight = {};
  for (const f of vids) {
    const h = f.height;
    const cur = byHeight[h] || { height: h, fps: 0, hdr: false, top: null };
    cur.fps = Math.max(cur.fps, f.fps || 0);
    cur.hdr = cur.hdr || (f.dynamic_range && f.dynamic_range !== 'SDR');
    if (!cur.top || rate(f) > rate(cur.top)) cur.top = f; // the stream "Best" will pick at this height
    byHeight[h] = cur;
  }
  const qualities = Object.values(byHeight).sort((a, b) => b.height - a.height).map(({ top, ...q }) => {
    const muxed = top.acodec && top.acodec !== 'none';
    q.size = top.filesize && (muxed || audioSize) ? top.filesize + (muxed ? 0 : audioSize) : null;
    return q;
  });
  const bestAudio = audioSize;

  return {
    kind: 'video', url: info.webpage_url || url, id: info.id, title: info.title || info.id || 'Video', site,
    uploader: info.uploader || info.channel || info.creator || info.uploader_id || null,
    duration: dur || null, thumbnail: bestThumb(info), qualities,
    audioSize: bestAudio || null, hasVideo: vids.length > 0 || !formats.length || formats.some((f) => f.vcodec !== 'none'),
    isLive: !!info.is_live,
  };
}

module.exports = { Engine, explain };
