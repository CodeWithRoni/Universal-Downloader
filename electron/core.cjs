// Universal Downloader — core logic (pure Node.js, no Electron imports).
// All downloading is done by the yt-dlp binary (bundled with the app, a copy
// the app downloaded on first run, or yt-dlp from the system PATH — in that
// order). ffmpeg is used by yt-dlp to merge video+audio and to extract MP3.
'use strict'

const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const https = require('https')

const IS_WIN = process.platform === 'win32'

function exeName(base) {
  return IS_WIN ? `${base}.exe` : base
}

// ---------------------------------------------------------------------------
// Binary lookup
// ---------------------------------------------------------------------------

function findOnPath(name) {
  try {
    const out = spawnSync(name, ['--version'], { encoding: 'utf8' })
    if (out.status === 0 || (out.stdout && out.stdout.length > 0)) return name
  } catch { /* not on PATH */ }
  return null
}

/// Look for a tool binary in the given folders (bundled, app-downloaded),
/// then fall back to the system PATH.
function findBinary(base, dirs) {
  const name = exeName(base)
  for (const dir of dirs || []) {
    if (!dir) continue
    const p = path.join(dir, name)
    if (fs.existsSync(p)) return p
  }
  return findOnPath(name)
}

function toolVersion(binPath) {
  try {
    const out = spawnSync(binPath, ['--version'], { encoding: 'utf8' })
    if (out.status === 0) return String(out.stdout || '').trim()
  } catch { /* ignore */ }
  return null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtSize(bytes) {
  if (!bytes || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(1)} ${units[i]}`
}

function fnum(v, key) {
  const x = v && v[key]
  return typeof x === 'number' ? x : null
}

function runYtdlpJsonOnce(binPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (e) => reject(new Error(`Could not run yt-dlp: ${e.message}`)))
    child.on('close', (code) => {
      if (code !== 0) {
        const tail = stderr.trim().split('\n').slice(-3).join(' ')
        reject(new Error(`yt-dlp error: ${tail}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (e) {
        reject(new Error(`Could not read video info: ${e.message}`))
      }
    })
  })
}

/// Run yt-dlp for metadata. If YouTube blocks the default client on this
/// network (the common "Sign in to confirm you're not a bot" error), retry
/// once with alternate player clients — this fixes fetching on many IPs.
async function runYtdlpJson(binPath, args) {
  try {
    return await runYtdlpJsonOnce(binPath, args)
  } catch (firstErr) {
    const retry = [
      ...args,
      '--extractor-args',
      'youtube:player_client=web_safari,ios,android_vr,tv',
      '--ignore-no-formats-error',
    ]
    try {
      return await runYtdlpJsonOnce(binPath, retry)
    } catch {
      throw new Error(
        `${firstErr.message} Tip: if YouTube keeps blocking, try again later or from a different network.`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Info parsing (mirrors the shapes the React UI expects)
// ---------------------------------------------------------------------------

/// "90" -> 90, "1:30" -> 90, "1:02:03" -> 3723. Invalid -> null.
function parseTime(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  const parts = s.split(':')
  if (parts.length < 2 || parts.length > 3 || parts.some((x) => !/^\d{1,2}$/.test(x))) return null
  return parts.reduce((acc, x) => acc * 60 + parseInt(x, 10), 0)
}

function cookieArgs(opts) {
  return opts && opts.cookiesBrowser ? ['--cookies-from-browser', opts.cookiesBrowser] : []
}

function parsePlaylist(data) {
  const entries = []
  let firstThumb = ''
  for (const e of data.entries || []) {
    const id = e.id || ''
    if (!id) continue
    const videoUrl =
      typeof e.url === 'string' && e.url.startsWith('http')
        ? e.url
        : `https://www.youtube.com/watch?v=${id}`
    const thumbs = Array.isArray(e.thumbnails) ? e.thumbnails : []
    const thumb = thumbs.length ? thumbs[thumbs.length - 1].url || '' : ''
    if (!firstThumb && thumb) firstThumb = thumb
    entries.push({
      id,
      title: e.title || 'Untitled video',
      duration: fnum(e, 'duration'),
      url: videoUrl,
      thumbnail: thumb,
    })
  }
  return {
    kind: 'playlist',
    title: data.title || 'Playlist',
    thumbnail: firstThumb,
    entries,
  }
}

function langName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code
  } catch {
    return code
  }
}

/// Subtitle choices for the UI: real (manual) subtitles first, then
/// auto-generated captions (priority languages first, capped — YouTube
/// lists 100+ machine-translation targets, which would flood the menu).
function parseSubtitles(data) {
  const out = []
  const seen = new Set()
  const manual = data.subtitles || {}
  for (const lang of Object.keys(manual)) {
    const fmts = manual[lang]
    const name = (Array.isArray(fmts) && fmts[0] && fmts[0].name) || langName(lang)
    out.push({ lang, label: name, auto: false })
    seen.add(lang)
  }
  const priority = ['bn', 'en', 'hi', 'ur', 'ar', 'es', 'fr', 'de', 'id', 'ms']
  const autoLangs = Object.keys(data.automatic_captions || {}).filter((l) => !seen.has(l))
  autoLangs.sort((a, b) => {
    const pa = priority.indexOf(a)
    const pb = priority.indexOf(b)
    if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb)
    return a.localeCompare(b)
  })
  for (const lang of autoLangs.slice(0, 40)) {
    out.push({ lang, label: `${langName(lang)} (auto)`, auto: true })
  }
  return out
}

function parseVideo(data) {
  const formats = Array.isArray(data.formats) ? data.formats : []

  // Best audio size (used to estimate merged video sizes).
  let bestAudioSize = 0
  // Audio-only options keyed by bitrate.
  const audioMap = new Map()
  for (const f of formats) {
    const acodec = f.acodec || 'none'
    const vcodec = f.vcodec || 'none'
    if (acodec === 'none') continue
    const size = fnum(f, 'filesize') ?? fnum(f, 'filesize_approx') ?? 0
    if (vcodec === 'none') {
      if (size > bestAudioSize) bestAudioSize = size
      const abr = Math.round(fnum(f, 'abr') || 0)
      if (abr > 0) {
        audioMap.set(abr, {
          format_id: f.format_id || '',
          label: `Audio • ${abr} kbps (${f.ext || ''})`,
          size_text: fmtSize(size),
        })
      }
    }
  }
  // Highest bitrate first, at most 4 choices.
  const audioOptions = [...audioMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, 4)
    .map(([, v]) => v)

  // Video options grouped by height (keep the largest/best per height).
  const byHeight = new Map()
  for (const f of formats) {
    const vcodec = f.vcodec || 'none'
    if (vcodec === 'none') continue
    const hFloat = fnum(f, 'height')
    if (!hFloat || hFloat <= 0) continue
    const height = Math.trunc(hFloat)
    const acodec = f.acodec || 'none'
    const exact = fnum(f, 'filesize')
    const sizeV = exact ?? fnum(f, 'filesize_approx') ?? 0
    const total = acodec === 'none' ? sizeV + bestAudioSize : sizeV
    const approx = exact === null
    const cur = byHeight.get(height)
    if (!cur || total >= cur.size) byHeight.set(height, { size: total, approx })
  }
  const videoOptions = [...byHeight.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([h, { size, approx }]) => {
      const tag =
        h >= 2160 ? ' (4K)' : h >= 1440 ? ' (2K)' : h >= 1080 ? ' (Full HD)' : h >= 720 ? ' (HD)' : ''
      return { height: h, label: `${h}p${tag}`, size_text: fmtSize(size), approx }
    })

  // Sites whose formats yt-dlp cannot enumerate (many non-YouTube sites):
  // offer one generic "best" choice instead of an empty list.
  if (videoOptions.length === 0 && audioOptions.length === 0) {
    videoOptions.push({ height: -1, label: 'Best quality (site default)', size_text: '—', approx: true })
  }

  return {
    kind: 'video',
    id: data.id || '',
    title: data.title || 'Untitled video',
    thumbnail: data.thumbnail || '',
    duration: fnum(data, 'duration'),
    uploader: data.uploader || data.channel || '',
    is_live: !!data.is_live,
    chapters: Array.isArray(data.chapters) ? data.chapters.length : 0,
    site: data.extractor || '',
    video_options: videoOptions,
    audio_options: audioOptions,
    subtitle_options: parseSubtitles(data),
  }
}

async function getInfo(binPath, url, opts = {}) {
  const link = String(url || '').trim()
  if (!link) throw new Error('Please paste a link first.')
  const cookies = cookieArgs(opts)
  const looksPlaylist = link.includes('list=') || link.includes('/playlist')

  // A channel link (youtube.com/@name, /channel/…, /c/…, /user/…) means
  // "the channel's latest videos" — fetch its videos tab as a playlist,
  // limited to the newest N (opts.playlistEnd, default 20).
  const isChannelUrl =
    /(?:youtube\.com\/(?:@|channel\/|c\/|user\/))/.test(link) &&
    !link.includes('watch?v=') &&
    !link.includes('list=')
  if (isChannelUrl) {
    let channelUrl = link
    const pathPart = channelUrl.split(/[?#]/)[0].replace(/\/$/, '')
    if (!/\/(videos|shorts|streams)$/.test(pathPart)) channelUrl = `${pathPart}/videos`
    const limit = opts.playlistEnd && opts.playlistEnd > 0 ? opts.playlistEnd : 20
    const data = await runYtdlpJson(binPath, [
      '--dump-single-json',
      '--flat-playlist',
      '--yes-playlist',
      '--no-warnings',
      '--playlist-end',
      String(limit),
      ...cookies,
      channelUrl,
    ])
    if (data._type === 'playlist') {
      const parsed = parsePlaylist(data)
      parsed.isChannel = true
      return parsed
    }
  }

  if (looksPlaylist) {
    const data = await runYtdlpJson(binPath, [
      '--dump-single-json',
      '--flat-playlist',
      '--yes-playlist',
      '--no-warnings',
      ...cookies,
      link,
    ])
    if (data._type === 'playlist') return parsePlaylist(data)
    // Not actually a playlist — fall through and treat as a single video.
  }

  const data = await runYtdlpJson(binPath, [
    '--dump-single-json',
    '--no-playlist',
    '--no-warnings',
    ...cookies,
    link,
  ])
  return parseVideo(data)
}

/// Search YouTube by text (ytsearch) — returns flat video entries.
function searchVideos(binPath, query, opts = {}) {
  const q = String(query || '').trim()
  if (!q) return Promise.reject(new Error('Type something to search for.'))
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 10
  const args = [
    '--dump-json',
    '--flat-playlist',
    '--no-warnings',
    ...cookieArgs(opts),
    `ytsearch${limit}:${q}`,
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (e) => reject(new Error(`Could not run yt-dlp: ${e.message}`)))
    child.on('close', (code) => {
      if (code !== 0) {
        const tail = stderr.trim().split('\n').slice(-2).join(' ')
        reject(new Error(`Search failed: ${tail}`))
        return
      }
      const entries = []
      for (const line of stdout.split('\n')) {
        const s = line.trim()
        if (!s) continue
        try {
          const e = JSON.parse(s)
          if (!e.id) continue
          const thumbs = Array.isArray(e.thumbnails) ? e.thumbnails : []
          entries.push({
            id: e.id,
            title: e.title || 'Untitled video',
            duration: typeof e.duration === 'number' ? e.duration : null,
            url: typeof e.url === 'string' && e.url.startsWith('http') ? e.url : `https://www.youtube.com/watch?v=${e.id}`,
            channel: e.channel || e.uploader || '',
            thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url || '' : '',
          })
        } catch { /* skip unparseable line */ }
      }
      resolve({ kind: 'search', entries })
    })
  })
}

// ---------------------------------------------------------------------------
// Downloading
// ---------------------------------------------------------------------------

function buildDownloadArgs(params) {
  const {
    mode, height, formatId, audioQuality, outDir, ffmpegPath, subtitle, embedTags,
    trim, sponsorBlock, splitChapters, liveFromStart,
    concurrentFragments, limitRate, archivePath, nameTemplate, playlistIndex,
  } = params
  const dir = String(outDir || '').replace(/[\\/]+$/, '')

  // Output filename pattern (Settings).
  let namePart = '%(title)s.%(ext)s'
  if (nameTemplate === 'title-quality' && mode === 'video') {
    namePart = '%(title)s [%(height)sp].%(ext)s'
  } else if (nameTemplate === 'index-title' && playlistIndex != null) {
    namePart = `${String(playlistIndex).padStart(2, '0')} - %(title)s.%(ext)s`
  }

  const args = [
    '--newline',
    '--no-warnings',
    '--no-playlist',
    '--progress-template',
    'download:TUBEGRAB|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
    '-o',
    `${dir}/${namePart}`,
  ]
  if (splitChapters && mode === 'video') {
    args.push('-o', `chapter:${dir}/%(section_number)02d - %(section_title)s.%(ext)s`)
  }
  if (ffmpegPath) args.push('--ffmpeg-location', ffmpegPath)
  if (concurrentFragments && concurrentFragments >= 2) {
    args.push('--concurrent-fragments', String(concurrentFragments))
  }
  if (limitRate) args.push('--limit-rate', String(limitRate))
  if (archivePath) args.push('--download-archive', archivePath)

  if (mode === 'audio') {
    args.push('-f', formatId || 'bestaudio/best')
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', audioQuality ? `${audioQuality}K` : '0')
    if (embedTags) {
      // Cover art + title/artist tags inside the MP3.
      args.push('--embed-metadata', '--embed-thumbnail', '--convert-thumbnails', 'jpg')
    }
  } else {
    const h = height == null ? 720 : height
    if (h === -1) {
      // Generic site: take the best it offers, no forced container.
      args.push('-f', 'bestvideo+bestaudio/best')
    } else {
      args.push('-f', `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`)
      args.push('--merge-output-format', 'mp4')
    }
    args.push('--embed-metadata')
    if (subtitle && subtitle.lang) {
      args.push(subtitle.auto ? '--write-auto-subs' : '--write-subs')
      args.push('--sub-langs', subtitle.lang)
      if (subtitle.embed) {
        args.push('--embed-subs')
      } else {
        // A separate .srt file next to the video.
        args.push('--convert-subs', 'srt')
      }
    }
    if (trim && (trim.start || trim.end)) {
      const s = parseTime(trim.start)
      const e = parseTime(trim.end)
      if (s != null || e != null) {
        args.push('--download-sections', `*${s || 0}-${e == null ? '' : e}`)
        args.push('--force-keyframes-at-cuts')
      }
    }
    if (sponsorBlock === 'remove') {
      args.push('--sponsorblock-remove', 'sponsor,intro,outro,selfpromo,preview')
    } else if (sponsorBlock === 'mark') {
      args.push('--sponsorblock-mark', 'sponsor,intro,outro,selfpromo')
    }
    if (splitChapters) args.push('--split-chapters')
    if (liveFromStart) args.push('--live-from-start')
  }
  return args
}

function parseProgressLine(line) {
  if (line.startsWith('TUBEGRAB|')) {
    const parts = line.slice('TUBEGRAB|'.length).split('|')
    const percent = parseFloat(String(parts[0] || '').trim().replace(/%$/, '').trim()) || 0
    return {
      type: 'progress',
      percent,
      speed: (parts[1] || '').trim(),
      eta: (parts[2] || '').trim(),
    }
  }
  if (line.includes('[Merger]') || line.includes('[ExtractAudio]') || line.includes('Post-process')) {
    return { type: 'processing' }
  }
  return null
}

const jobs = new Map()
const stopReasons = new Map() // job id -> 'cancelled' | 'paused'

function killTree(child) {
  if (!child || child.killed) return
  if (IS_WIN && child.pid) {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      return
    } catch { /* fall through */ }
  }
  // POSIX: the child was spawned detached (its own process group), so kill
  // the whole group — this also stops ffmpeg helpers yt-dlp started, which
  // would otherwise keep the output pipes (and the job) hanging.
  if (!IS_WIN && child.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL')
      return
    } catch { /* group already gone */ }
  }
  try {
    child.kill('SIGKILL')
  } catch { /* already gone */ }
}

/// Spawn a download. Resolves as soon as the process has started (progress
/// and the final state are reported through onProgress), mirroring the old
/// backend's behaviour. Rejects if the process cannot be started at all.
function startDownloadProcess({ binPath, args, url, id, onProgress }) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(binPath, [...args, url], { stdio: ['ignore', 'pipe', 'pipe'], detached: !IS_WIN })
    } catch (e) {
      reject(new Error(`Could not start download: ${e.message}`))
      return
    }
    jobs.set(id, child)
    let settled = false
    let lastError = ''
    let lastPercent = 0
    let lastDestination = null
    let finalPath = null

    child.stdout.setEncoding('utf8')
    let buf = ''
    child.stdout.on('data', (chunk) => {
      buf += chunk
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '')
        buf = buf.slice(idx + 1)
        // Remember where the file is going, so the UI can offer
        // "Open file" / "Show in folder" when the download finishes.
        let m
        if ((m = line.match(/^\[download\] Destination: (.+)$/))) {
          lastDestination = m[1].trim()
        } else if ((m = line.match(/^\[Merger\] Merging formats into "(.+)"$/))) {
          finalPath = m[1]
        } else if ((m = line.match(/^\[ExtractAudio\] Destination: (.+)$/))) {
          finalPath = m[1].trim()
        }
        const parsed = parseProgressLine(line)
        if (!parsed) continue
        if (parsed.type === 'progress') {
          lastPercent = parsed.percent
          onProgress({ id, status: 'downloading', percent: parsed.percent, speed: parsed.speed, eta: parsed.eta })
        } else {
          onProgress({ id, status: 'processing', percent: 100, speed: '', eta: '' })
        }
      }
    })
    child.stderr.setEncoding('utf8')
    let errBuf = ''
    child.stderr.on('data', (chunk) => {
      errBuf += chunk
      let idx
      while ((idx = errBuf.indexOf('\n')) >= 0) {
        const line = errBuf.slice(0, idx)
        errBuf = errBuf.slice(idx + 1)
        if (line.includes('ERROR')) lastError = line
      }
    })
    child.on('error', (e) => {
      if (!settled) {
        settled = true
        jobs.delete(id)
        reject(new Error(`Could not start download: ${e.message}`))
      }
    })
    child.on('spawn', () => {
      if (!settled) {
        settled = true
        resolve()
      }
    })
    child.on('close', (code) => {
      jobs.delete(id)
      const stopReason = stopReasons.get(id)
      stopReasons.delete(id)
      let status
      let error
      if (stopReason) {
        status = stopReason // 'cancelled' or 'paused'
      } else if (code === 0) {
        status = 'done'
      } else {
        status = 'error'
        error = lastError || 'Download failed'
      }
      const payload = {
        id,
        status,
        percent: status === 'done' ? 100 : status === 'paused' ? lastPercent : 0,
        speed: '',
        eta: '',
      }
      if (error) payload.error = error
      // yt-dlp keeps the .part file, so a paused download resumes where it
      // stopped when the same link/quality/folder is downloaded again.
      if (status === 'done' && (finalPath || lastDestination)) {
        payload.filePath = finalPath || lastDestination
        try {
          payload.sizeBytes = fs.statSync(payload.filePath).size
        } catch { /* file moved/deleted already */ }
      }
      onProgress(payload)
    })
  })
}

function stopDownload(id, reason) {
  stopReasons.set(id, reason)
  const child = jobs.get(id)
  if (child) {
    jobs.delete(id)
    killTree(child)
  }
}

function cancelDownload(id) {
  stopDownload(id, 'cancelled')
}

/// Pause = stop the process but keep the partial (.part) file, so resuming
/// (starting the same download again) continues instead of restarting.
function pauseDownload(id) {
  stopDownload(id, 'paused')
}

// ---------------------------------------------------------------------------
// First-run yt-dlp download
// ---------------------------------------------------------------------------

function downloadYtdlp(destDir) {
  const asset = IS_WIN ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux'
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`
  fs.mkdirSync(destDir, { recursive: true })
  const dest = path.join(destDir, exeName('yt-dlp'))

  const fetch = (u, redirects) =>
    new Promise((resolve, reject) => {
      https
        .get(u, { headers: { 'User-Agent': 'Universal-Downloader' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume()
            if (redirects <= 0) {
              reject(new Error('Too many redirects'))
              return
            }
            resolve(fetch(res.headers.location, redirects - 1))
            return
          }
          if (res.statusCode !== 200) {
            res.resume()
            reject(new Error(`Downloading yt-dlp failed (HTTP ${res.statusCode}) — check your internet connection.`))
            return
          }
          const file = fs.createWriteStream(dest)
          res.pipe(file)
          file.on('finish', () => file.close(() => resolve()))
          file.on('error', reject)
        })
        .on('error', (e) =>
          reject(new Error(`Downloading yt-dlp failed — check your internet connection. (${e.message})`)),
        )
    })

  return fetch(url, 5).then(() => {
    if (!IS_WIN) {
      try {
        fs.chmodSync(dest, 0o755)
      } catch { /* best effort */ }
    }
    return dest
  })
}

module.exports = {
  exeName,
  findBinary,
  toolVersion,
  fmtSize,
  fnum,
  parsePlaylist,
  parseVideo,
  getInfo,
  searchVideos,
  parseTime,
  buildDownloadArgs,
  parseProgressLine,
  startDownloadProcess,
  cancelDownload,
  pauseDownload,
  downloadYtdlp,
}
