// YouTube Downloader — core logic (pure Node.js, no Electron imports).
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

  return {
    kind: 'video',
    title: data.title || 'Untitled video',
    thumbnail: data.thumbnail || '',
    duration: fnum(data, 'duration'),
    uploader: data.uploader || '',
    video_options: videoOptions,
    audio_options: audioOptions,
  }
}

async function getInfo(binPath, url) {
  const link = String(url || '').trim()
  if (!link) throw new Error('Please paste a YouTube link first.')
  const looksPlaylist = link.includes('list=') || link.includes('/playlist')

  if (looksPlaylist) {
    const data = await runYtdlpJson(binPath, [
      '--dump-single-json',
      '--flat-playlist',
      '--yes-playlist',
      '--no-warnings',
      link,
    ])
    if (data._type === 'playlist') return parsePlaylist(data)
    // Not actually a playlist — fall through and treat as a single video.
  }

  const data = await runYtdlpJson(binPath, [
    '--dump-single-json',
    '--no-playlist',
    '--no-warnings',
    link,
  ])
  return parseVideo(data)
}

// ---------------------------------------------------------------------------
// Downloading
// ---------------------------------------------------------------------------

function buildDownloadArgs({ mode, height, formatId, audioQuality, outDir, ffmpegPath }) {
  const args = [
    '--newline',
    '--no-warnings',
    '--no-playlist',
    '--progress-template',
    'download:TUBEGRAB|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
    '-o',
    `${String(outDir || '').replace(/[\\/]+$/, '')}/%(title)s.%(ext)s`,
  ]
  if (ffmpegPath) args.push('--ffmpeg-location', ffmpegPath)
  if (mode === 'audio') {
    args.push('-f', formatId || 'bestaudio/best')
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', audioQuality ? `${audioQuality}K` : '0')
  } else {
    const h = height || 720
    args.push('-f', `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`)
    args.push('--merge-output-format', 'mp4')
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
const cancelled = new Set()

function killTree(child) {
  if (!child || child.killed) return
  if (IS_WIN && child.pid) {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      return
    } catch { /* fall through */ }
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
      child = spawn(binPath, [...args, url], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      reject(new Error(`Could not start download: ${e.message}`))
      return
    }
    jobs.set(id, child)
    let settled = false
    let lastError = ''

    child.stdout.setEncoding('utf8')
    let buf = ''
    child.stdout.on('data', (chunk) => {
      buf += chunk
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '')
        buf = buf.slice(idx + 1)
        const parsed = parseProgressLine(line)
        if (!parsed) continue
        if (parsed.type === 'progress') {
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
      const wasCancelled = cancelled.delete(id)
      let status
      let error
      if (wasCancelled) {
        status = 'cancelled'
      } else if (code === 0) {
        status = 'done'
      } else {
        status = 'error'
        error = lastError || 'Download failed'
      }
      const payload = { id, status, percent: status === 'done' ? 100 : 0, speed: '', eta: '' }
      if (error) payload.error = error
      onProgress(payload)
    })
  })
}

function cancelDownload(id) {
  cancelled.add(id)
  const child = jobs.get(id)
  if (child) {
    jobs.delete(id)
    killTree(child)
  }
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
        .get(u, { headers: { 'User-Agent': 'YouTube-Downloader' } }, (res) => {
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
  buildDownloadArgs,
  parseProgressLine,
  startDownloadProcess,
  cancelDownload,
  downloadYtdlp,
}
