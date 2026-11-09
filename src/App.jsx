import { useEffect, useRef, useState } from 'react'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function invoke(cmd, args) {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke(cmd, args)
}

const GENERIC_HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240, 144]
const GENERIC_AUDIO = [
  { key: '320', label: 'MP3 • 320 kbps (Best)' },
  { key: '192', label: 'MP3 • 192 kbps' },
  { key: '128', label: 'MP3 • 128 kbps (Smallest)' },
]

// ---------- demo data for browser preview (npm run dev without Tauri) ----------
const DEMO_VIDEO = {
  kind: 'video', title: 'Demo Video — Browser Preview Mode', thumbnail: '',
  duration: 754, uploader: 'Demo Channel',
  video_options: [
    { height: 1080, label: '1080p (Full HD)', size_text: '~84.2 MB', approx: true },
    { height: 720, label: '720p (HD)', size_text: '46.7 MB', approx: false },
    { height: 480, label: '480p', size_text: '21.3 MB', approx: false },
    { height: 360, label: '360p', size_text: '12.9 MB', approx: false },
  ],
  audio_options: [
    { format_id: '251', label: 'Audio • 160 kbps (webm)', size_text: '9.8 MB' },
    { format_id: '140', label: 'Audio • 128 kbps (m4a)', size_text: '7.9 MB' },
  ],
}

function fmtDuration(sec) {
  if (!sec && sec !== 0) return ''
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60)
  return (h ? `${h}:` : '') + `${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`
}

export default function App() {
  const [url, setUrl] = useState('')
  const [probing, setProbing] = useState(false)
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('video') // 'video' | 'audio'
  const [height, setHeight] = useState(720)
  const [audioChoice, setAudioChoice] = useState('') // format_id (single) or bitrate key (playlist)
  const [selected, setSelected] = useState({}) // playlist entry id -> bool
  const [jobs, setJobs] = useState([])
  const [outDir, setOutDir] = useState('')
  const [tools, setTools] = useState(null)
  const timers = useRef({})

  // ---- init: tools status + default folder; progress listener ----
  useEffect(() => {
    if (!isTauri) { setTools({ yt_dlp: false, ffmpeg: false, demo: true }); setOutDir('~/Downloads'); return }
    invoke('tools_status').then(setTools).catch(() => setTools({ yt_dlp: false, ffmpeg: false }))
    invoke('default_download_dir').then(setOutDir).catch(() => {})
    let unlisten
    import('@tauri-apps/api/event').then(async ({ listen }) => {
      unlisten = await listen('download-progress', (e) => {
        const p = e.payload
        setJobs((prev) => prev.map((j) => (j.id === p.id ? { ...j, ...p } : j)))
      })
    })
    return () => { if (unlisten) unlisten() }
  }, [])

  // ---- run queued jobs, max 2 at a time ----
  useEffect(() => {
    const running = jobs.filter((j) => j.status === 'downloading' || j.status === 'processing').length
    const next = jobs.find((j) => j.status === 'queued')
    if (next && running < 2) startJob(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs])

  async function probe() {
    const link = url.trim()
    if (!link) return
    setProbing(true); setError(''); setInfo(null)
    try {
      const data = isTauri ? await invoke('get_info', { url: link }) : DEMO_VIDEO
      setInfo(data)
      if (data.kind === 'video') {
        setHeight(data.video_options?.[1]?.height ?? data.video_options?.[0]?.height ?? 720)
        setAudioChoice(data.audio_options?.[0]?.format_id ?? '')
      } else {
        setHeight(720); setAudioChoice('192')
        const all = {}; data.entries.forEach((en) => { all[en.id] = true }); setSelected(all)
      }
    } catch (e) {
      setError(isTauri ? String(e) : 'Demo mode: run the Tauri app for real downloads.')
    } finally { setProbing(false) }
  }

  async function pickFolder() {
    if (!isTauri) return
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const dir = await open({ directory: true, multiple: false, defaultPath: outDir || undefined })
      if (dir) setOutDir(dir)
    } catch { /* user can also type the path manually */ }
  }

  function enqueue(newJobs) {
    setJobs((prev) => [...newJobs, ...prev])
  }

  function downloadSingle() {
    enqueue([{
      id: crypto.randomUUID(), url: url.trim(), title: info.title,
      mode, height: mode === 'video' ? height : null,
      formatId: mode === 'audio' ? audioChoice : null, audioQuality: null,
      status: 'queued', percent: 0, speed: '', eta: '',
    }])
  }

  function downloadPlaylist() {
    const chosen = info.entries.filter((en) => selected[en.id])
    if (!chosen.length) return
    enqueue(chosen.map((en) => ({
      id: crypto.randomUUID(), url: en.url, title: en.title,
      mode, height: mode === 'video' ? height : null,
      formatId: null, audioQuality: mode === 'audio' ? audioChoice : null,
      status: 'queued', percent: 0, speed: '', eta: '',
    })))
  }

  async function startJob(job) {
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'downloading' } : j)))
    if (!isTauri) {
      // demo simulation
      let p = 0
      timers.current[job.id] = setInterval(() => {
        p += Math.random() * 9
        if (p >= 100) {
          clearInterval(timers.current[job.id])
          setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, percent: 100, status: 'done', speed: '', eta: '' } : j)))
        } else {
          setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, percent: Math.floor(p), speed: '3.2MiB/s', eta: '00:12' } : j)))
        }
      }, 350)
      return
    }
    try {
      await invoke('start_download', {
        jobId: job.id, url: job.url, mode: job.mode, height: job.height,
        formatId: job.formatId, audioQuality: job.audioQuality, outDir,
      })
    } catch (e) {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'error', error: String(e) } : j)))
    }
  }

  async function cancelJob(job) {
    if (!isTauri) {
      clearInterval(timers.current[job.id])
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'cancelled' } : j)))
      return
    }
    try { await invoke('cancel_download', { jobId: job.id }) } catch { /* already finished */ }
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'cancelled' } : j)))
  }

  const videoOptions = info?.kind === 'video'
    ? info.video_options
    : GENERIC_HEIGHTS.map((h) => ({ height: h, label: `${h}p${h >= 720 ? ' (HD' + (h >= 2160 ? '+' : '') + ')' : ''}`, size_text: 'auto', approx: true }))
  const audioOptions = info?.kind === 'video'
    ? (info.audio_options || []).map((a) => ({ key: a.format_id, label: a.label, size: a.size_text }))
    : GENERIC_AUDIO.map((a) => ({ key: a.key, label: a.label, size: '' }))
  const selectedCount = info?.kind === 'playlist' ? info.entries.filter((e) => selected[e.id]).length : 0

  return (
    <div className="app">
      <header>
        <div className="brand"><span className="brand-icon">▶</span> YouTube <span className="brand-thin">Downloader</span></div>
        <div className={`tools ${tools?.yt_dlp ? 'ok' : 'warn'}`}>
          {!tools ? 'Checking tools…'
            : tools.demo ? 'Browser preview — demo mode'
            : tools.yt_dlp ? `yt-dlp ${tools.version || ''} ready${tools.ffmpeg ? ' • ffmpeg ready' : ' • ffmpeg missing (needed above 720p & MP3)'}`
            : 'yt-dlp not found'}
          {isTauri && tools && !tools.yt_dlp && (
            <button
              style={{ marginLeft: 10, background: 'var(--grad)', border: 'none', color: '#fff', borderRadius: 8, padding: '4px 12px', fontWeight: 700 }}
              onClick={async (e) => {
                e.target.textContent = 'Installing…'
                try { await invoke('download_ytdlp'); setTools(await invoke('tools_status')) }
                catch { e.target.textContent = 'Install failed — check internet' }
              }}
            >Install yt-dlp</button>
          )}
        </div>
      </header>

      <section className="paste-card">
        <div className="paste-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && probe()}
            placeholder="Paste a YouTube link here — video or playlist…"
            spellCheck={false}
          />
          <button className="btn-fetch" onClick={probe} disabled={probing || !url.trim()}>
            {probing ? 'Fetching…' : 'Fetch'}
          </button>
        </div>
        {!isTauri && (
        <div style={{ marginTop: 14, border: '1px dashed var(--border)', borderRadius: 12, padding: '12px 14px', color: 'var(--muted)', fontSize: '.9rem' }}>
          🌐 You are viewing the <strong style={{ color: '#fff' }}>web preview</strong> — the full design works here with demo data,
          but real downloads need the desktop app (a browser cannot run the download engine).
          <a href="https://github.com/CodeWithRoni/Youtube-Downloader/releases" target="_blank" rel="noreferrer"
             style={{ color: '#ff5e3a', fontWeight: 700, marginLeft: 8 }}>Get the Desktop App ↓</a>
        </div>
      )}
      {error && <p className="error">⚠ {error}</p>}
        <div className="folder-row">
          <span>Save to:</span>
          <input value={outDir} onChange={(e) => setOutDir(e.target.value)} spellCheck={false} />
          <button onClick={pickFolder}>Browse…</button>
        </div>
      </section>

      {info && (
        <section className="result-card">
          <div className="result-head">
            {info.thumbnail
              ? <img src={info.thumbnail} alt="" />
              : <div className="thumb-placeholder">▶</div>}
            <div>
              <h2>{info.title}</h2>
              <p className="muted">
                {info.kind === 'playlist'
                  ? `Playlist • ${info.entries.length} videos`
                  : `${info.uploader || ''} ${info.duration ? '• ' + fmtDuration(info.duration) : ''}`}
              </p>
            </div>
          </div>

          <div className="mode-toggle">
            <button className={mode === 'video' ? 'active' : ''} onClick={() => setMode('video')}>🎬 Video</button>
            <button className={mode === 'audio' ? 'active' : ''} onClick={() => setMode('audio')}>🎵 Audio (MP3)</button>
          </div>

          {mode === 'video' ? (
            <div className="option-list">
              {videoOptions.map((o) => (
                <label key={o.height} className={`option ${height === o.height ? 'chosen' : ''}`}>
                  <input type="radio" name="q" checked={height === o.height} onChange={() => setHeight(o.height)} />
                  <span className="option-label">{o.label}</span>
                  <span className="option-size">{o.size_text === 'auto' ? 'best available' : `${o.approx ? '~' : ''}${o.size_text.replace(/^~/, '')}`}</span>
                </label>
              ))}
              <p className="hint">Above 720p, YouTube sends video and audio separately — the app merges them into one MP4 with ffmpeg.</p>
            </div>
          ) : (
            <div className="option-list">
              {audioOptions.map((o) => (
                <label key={o.key} className={`option ${audioChoice === o.key ? 'chosen' : ''}`}>
                  <input type="radio" name="a" checked={audioChoice === o.key} onChange={() => setAudioChoice(o.key)} />
                  <span className="option-label">{o.label}</span>
                  <span className="option-size">{o.size}</span>
                </label>
              ))}
              <p className="hint">Audio is extracted and converted to MP3 with ffmpeg.</p>
            </div>
          )}

          {info.kind === 'playlist' && (
            <div className="playlist">
              <div className="playlist-bar">
                <strong>{selectedCount} of {info.entries.length} selected</strong>
                <div>
                  <button onClick={() => { const a = {}; info.entries.forEach((e) => { a[e.id] = true }); setSelected(a) }}>Select all</button>
                  <button onClick={() => setSelected({})}>Select none</button>
                </div>
              </div>
              <div className="playlist-items">
                {info.entries.map((en, i) => (
                  <label key={en.id} className="playlist-item">
                    <input type="checkbox" checked={!!selected[en.id]}
                      onChange={() => setSelected((s) => ({ ...s, [en.id]: !s[en.id] }))} />
                    <span className="pl-idx">{i + 1}</span>
                    <span className="pl-title">{en.title}</span>
                    <span className="muted">{fmtDuration(en.duration)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <button
            className="btn-download"
            onClick={info.kind === 'playlist' ? downloadPlaylist : downloadSingle}
            disabled={info.kind === 'playlist' && selectedCount === 0}
          >
            ⬇ Download {info.kind === 'playlist' ? `${selectedCount} Video${selectedCount === 1 ? '' : 's'}` : mode === 'video' ? 'Video' : 'Audio'}
            {info.kind !== 'playlist' && mode === 'video' ? ` • ${height}p` : ''}
          </button>
        </section>
      )}

      {jobs.length > 0 && (
        <section className="jobs-card">
          <h3>Downloads</h3>
          {jobs.map((j) => (
            <div key={j.id} className="job">
              <div className="job-top">
                <span className="job-title">{j.title}</span>
                <span className={`job-status ${j.status}`}>
                  {j.status === 'queued' && 'Queued'}
                  {j.status === 'downloading' && `${j.percent || 0}% • ${j.speed || ''} ${j.eta ? '• ETA ' + j.eta : ''}`}
                  {j.status === 'processing' && 'Processing (merging / converting)…'}
                  {j.status === 'done' && '✓ Done'}
                  {j.status === 'error' && `✗ ${j.error || 'Failed'}`}
                  {j.status === 'cancelled' && 'Cancelled'}
                </span>
              </div>
              <div className="job-bar">
                <div className={`job-fill ${j.status}`} style={{ width: `${j.status === 'done' ? 100 : j.percent || 0}%` }} />
              </div>
              {(j.status === 'downloading' || j.status === 'queued' || j.status === 'processing') && (
                <button className="job-cancel" onClick={() => cancelJob(j)}>Cancel</button>
              )}
            </div>
          ))}
          <button className="clear-btn" onClick={() => setJobs((prev) => prev.filter((j) => ['downloading', 'processing', 'queued'].includes(j.status)))}>
            Clear finished
          </button>
        </section>
      )}

      <footer>For personal use only — please respect creators' copyright and YouTube's terms. Built with Tauri + React + yt-dlp.</footer>
    </div>
  )
}
