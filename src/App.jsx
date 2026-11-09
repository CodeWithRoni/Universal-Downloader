import { useEffect, useRef, useState } from 'react'

const isDesktop = typeof window !== 'undefined' && !!window.desktopAPI
const isNativeMobile = typeof window !== 'undefined' && !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
const api = () => window.desktopAPI

function cleanErr(e) {
  return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

const GENERIC_HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240, 144]
const GENERIC_AUDIO = [
  { key: '320', label: 'MP3 • 320 kbps (Best)' },
  { key: '192', label: 'MP3 • 192 kbps' },
  { key: '128', label: 'MP3 • 128 kbps (Smallest)' },
]

// ---------- demo data for browser preview (no desktop app) ----------
const DEMO_VIDEO = {
  kind: 'video', id: 'demo1234567', title: 'Demo Video — Browser Preview Mode', thumbnail: '',
  duration: 754, uploader: 'Demo Channel', is_live: false, chapters: 12, site: 'youtube',
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
  subtitle_options: [
    { lang: 'bn', label: 'Bangla', auto: false },
    { lang: 'en', label: 'English', auto: false },
    { lang: 'en', label: 'English (auto)', auto: true },
  ],
}

// Used for playlists (per-video subtitle lists are not fetched in flat mode)
const GENERIC_SUBS = [
  { lang: 'bn', label: 'Bangla', auto: false },
  { lang: 'en', label: 'English', auto: false },
  { lang: 'hi', label: 'Hindi', auto: false },
  { lang: 'ur', label: 'Urdu', auto: false },
  { lang: 'ar', label: 'Arabic', auto: false },
  { lang: 'en', label: 'English (auto captions)', auto: true },
  { lang: 'bn', label: 'Bangla (auto captions)', auto: true },
]
const subKeyOf = (s) => `${s.lang}::${s.auto ? 'a' : 'm'}`

// ---------- UI language (English / বাংলা) ----------
const STRINGS = {
  en: {
    fetch: 'Fetch', fetching: 'Fetching…', saveTo: 'Save to:', browse: 'Browse…',
    video: '🎬 Video', audio: '🎵 Audio (MP3)', subtitles: 'Subtitles:',
    downloads: 'Downloads', history: 'History', settings: 'Settings',
    pause: '⏸ Pause', resume: '▶ Resume', cancel: 'Cancel', retry: '↻ Retry',
    openFile: '▶ Open file', folder: '📂 Folder', downloadAgain: '⬇ Download again',
    remove: 'Remove', clearAll: 'Clear all', clearFinished: 'Clear finished',
    queued: 'Queued', paused: 'Paused', done: '✓ Done', search: 'Search',
    searchPh: 'Or search YouTube by name…', pastePh: 'Paste a link here — YouTube or 1000+ other sites…',
    pauseAll: '⏸ Pause all', resumeAll: '▶ Resume all',
  },
  bn: {
    fetch: 'খুঁজুন', fetching: 'খোঁজা হচ্ছে…', saveTo: 'সেভ হবে:', browse: 'ব্রাউজ…',
    video: '🎬 ভিডিও', audio: '🎵 অডিও (MP3)', subtitles: 'সাবটাইটেল:',
    downloads: 'ডাউনলোডসমূহ', history: 'ইতিহাস', settings: 'সেটিংস',
    pause: '⏸ থামান', resume: '▶ আবার চালু', cancel: 'বাতিল', retry: '↻ আবার চেষ্টা',
    openFile: '▶ ফাইল খুলুন', folder: '📂 ফোল্ডার', downloadAgain: '⬇ আবার ডাউনলোড',
    remove: 'মুছুন', clearAll: 'সব মুছুন', clearFinished: 'শেষ হওয়াগুলো মুছুন',
    queued: 'অপেক্ষমাণ', paused: 'থামানো', done: '✓ শেষ', search: 'সার্চ',
    searchPh: 'অথবা নাম লিখে YouTube-এ খুঁজুন…', pastePh: 'এখানে লিংক পেস্ট করুন — YouTube বা আরও ১০০০+ সাইট…',
    pauseAll: '⏸ সব থামান', resumeAll: '▶ সব চালু করুন',
  },
}

const DEFAULT_SETTINGS = {
  lang: 'en', defaultQuality: 720, parallel: 2, concurrentFragments: 4,
  limitRate: '', audioDir: '', nameTemplate: 'title', cookiesBrowser: '',
  channelLimit: 20, archiveSkip: true, notify: true,
}

function fmtBytes(n) {
  if (!n || n <= 0) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  let v = n, i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${u[i]}`
}

function youtubeIdOf(u) {
  const m = String(u || '').match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

function pickDefaultHeight(options, wanted) {
  if (!options || !options.length) return wanted
  const heights = options.map((o) => o.height).filter((h) => h > 0)
  if (!heights.length) return options[0].height
  if (wanted === 'best') return heights[0]
  if (heights.includes(wanted)) return wanted
  const below = heights.filter((h) => h <= wanted)
  return below.length ? below[0] : heights[heights.length - 1]
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
  const [subKey, setSubKey] = useState('')
  const [subEmbed, setSubEmbed] = useState(false)
  const [embedTags, setEmbedTags] = useState(true)
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('yd-history-v1') || '[]') } catch { return [] }
  })
  const [settings, setSettings] = useState(() => {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('yd-settings-v1') || '{}') } } catch { return DEFAULT_SETTINGS }
  })
  const [showSettings, setShowSettings] = useState(false)
  const [trimStart, setTrimStart] = useState('')
  const [trimEnd, setTrimEnd] = useState('')
  const [sponsorSel, setSponsorSel] = useState('')
  const [splitCh, setSplitCh] = useState(false)
  const [liveChk, setLiveChk] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')
  const [dup, setDup] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [updateStatus, setUpdateStatus] = useState(null)
  const timers = useRef({})
  const jobsRef = useRef([])
  useEffect(() => {
    try { localStorage.setItem('yd-settings-v1', JSON.stringify(settings)) } catch { /* ignore */ }
  }, [settings])
  const set = (patch) => setSettings((s) => ({ ...s, ...patch }))
  const tr = (key) => (STRINGS[settings.lang] && STRINGS[settings.lang][key]) || STRINGS.en[key] || key
  useEffect(() => { jobsRef.current = jobs }, [jobs])
  useEffect(() => {
    try { localStorage.setItem('yd-history-v1', JSON.stringify(history)) } catch { /* full/blocked */ }
  }, [history])

  function addHistory(job, filePath, sizeBytes) {
    setHistory((prev) => {
      if (prev.some((h) => h.jobId === job.id)) return prev
      return [{
        jobId: job.id, title: job.title, url: job.url, mode: job.mode,
        height: job.height, filePath: filePath || null, sizeBytes: sizeBytes || 0, finishedAt: Date.now(),
      }, ...prev].slice(0, 100)
    })
  }

  function notifyDone(job) {
    if (!settings.notify) return
    try {
      new Notification('✓ Download complete', { body: job.title })
    } catch { /* notifications unavailable here */ }
  }

  // ---- init: tools status + default folder; progress listener ----
  useEffect(() => {
    if (!isDesktop) { setTools({ yt_dlp: false, ffmpeg: false, demo: true }); setOutDir('~/Downloads'); return }
    api().toolsStatus().then(setTools).catch(() => setTools({ yt_dlp: false, ffmpeg: false }))
    api().defaultDownloadDir().then(setOutDir).catch(() => {})
    const unlisten = api().onProgress((p) => {
      if (p.status === 'done') {
        const job = jobsRef.current.find((j) => j.id === p.id)
        if (job) { addHistory(job, p.filePath, p.sizeBytes); notifyDone(job) }
      }
      setJobs((prev) => prev.map((j) => (j.id === p.id ? { ...j, ...p } : j)))
    })
    const unLink = api().onExternalLink ? api().onExternalLink((link) => { setUrl(link); probe(link) }) : null
    const unUpd = api().onUpdateStatus ? api().onUpdateStatus((s) => setUpdateStatus(s)) : null
    return () => {
      if (unlisten) unlisten()
      if (unLink) unLink()
      if (unUpd) unUpd()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- run queued jobs, up to the Settings limit at a time ----
  useEffect(() => {
    const running = jobs.filter((j) => j.status === 'downloading' || j.status === 'processing').length
    const next = jobs.find((j) => j.status === 'queued')
    if (next && running < (settings.parallel || 2)) startJob(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, settings.parallel])

  // ---- scheduled jobs: move to the queue when their time comes ----
  useEffect(() => {
    const iv = setInterval(() => {
      setJobs((prev) => {
        if (!prev.some((j) => j.status === 'scheduled' && j.runAt && j.runAt <= Date.now())) return prev
        return prev.map((j) => (j.status === 'scheduled' && j.runAt && j.runAt <= Date.now() ? { ...j, status: 'queued' } : j))
      })
    }, 4000)
    return () => clearInterval(iv)
  }, [])

  async function probe(overrideUrl) {
    const link = String(overrideUrl ?? url).trim()
    if (!link) return
    setProbing(true); setError(''); setInfo(null); setDup(null)
    try {
      const data = isDesktop
        ? await api().getInfo(link, { cookiesBrowser: settings.cookiesBrowser, playlistEnd: settings.channelLimit })
        : DEMO_VIDEO
      setInfo(data)
      setSubKey('')
      setSplitCh(false)
      setLiveChk(!!data.is_live)
      if (data.kind === 'video') {
        setHeight(pickDefaultHeight(data.video_options, settings.defaultQuality))
        setAudioChoice(data.audio_options?.[0]?.format_id ?? '')
        const vid = youtubeIdOf(link) || data.id
        const prev = history.find((h) => (vid && youtubeIdOf(h.url) === vid) || h.url === link)
        if (prev) setDup(prev)
      } else {
        setHeight(720); setAudioChoice('192')
        const all = {}; data.entries.forEach((en) => { all[en.id] = true }); setSelected(all)
      }
    } catch (e) {
      setError(isDesktop ? cleanErr(e) : 'Demo mode: run the desktop app for real downloads.')
    } finally { setProbing(false) }
  }

  async function pickFolder() {
    if (!isDesktop) return
    try {
      const dir = await api().pickFolder()
      if (dir) setOutDir(dir)
    } catch { /* user can also type the path manually */ }
  }

  function enqueue(newJobs) {
    setJobs((prev) => [...newJobs, ...prev])
  }

  function jobExtras(single) {
    const runAt = scheduleAt ? new Date(scheduleAt).getTime() : null
    return {
      trim: single ? { start: trimStart, end: trimEnd } : null,
      sponsorBlock: sponsorSel || null,
      splitChapters: single && splitCh,
      liveFromStart: single && liveChk,
      concurrentFragments: settings.concurrentFragments,
      limitRate: settings.limitRate,
      useArchive: !single && settings.archiveSkip,
      nameTemplate: settings.nameTemplate,
      runAt,
      status: runAt && runAt > Date.now() ? 'scheduled' : 'queued',
    }
  }

  function currentSubtitle() {
    if (mode !== 'video' || !subKey) return null
    const list = info?.kind === 'video' ? (info.subtitle_options || []) : GENERIC_SUBS
    const found = list.find((s) => subKeyOf(s) === subKey)
    return found ? { lang: found.lang, auto: found.auto, embed: subEmbed } : null
  }

  function downloadSingle() {
    enqueue([{
      id: crypto.randomUUID(), url: url.trim(), title: info.title,
      mode, height: mode === 'video' ? height : null,
      formatId: mode === 'audio' ? audioChoice : null, audioQuality: null,
      subtitle: currentSubtitle(), embedTags, playlistIndex: null,
      ...jobExtras(true),
      percent: 0, speed: '', eta: '',
    }])
  }

  function downloadPlaylist() {
    const chosen = info.entries.filter((en) => selected[en.id])
    if (!chosen.length) return
    enqueue(chosen.map((en) => {
      const idx = info.entries.indexOf(en)
      return {
        id: crypto.randomUUID(), url: en.url, title: en.title,
        mode, height: mode === 'video' ? height : null,
        formatId: null, audioQuality: mode === 'audio' ? audioChoice : null,
        subtitle: currentSubtitle(), embedTags, playlistIndex: idx + 1,
        ...jobExtras(false),
        percent: 0, speed: '', eta: '',
      }
    }))
  }

  async function startJob(job) {
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'downloading' } : j)))
    if (!isDesktop) {
      // demo simulation
      let p = job.percent || 0
      timers.current[job.id] = setInterval(() => {
        p += Math.random() * 9
        if (p >= 100) {
          clearInterval(timers.current[job.id])
          addHistory(job, null, 0); notifyDone(job)
          setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, percent: 100, status: 'done', speed: '', eta: '' } : j)))
        } else {
          setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, percent: Math.floor(p), speed: '3.2MiB/s', eta: '00:12' } : j)))
        }
      }, 350)
      return
    }
    try {
      await api().startDownload({
        id: job.id, url: job.url, mode: job.mode, height: job.height,
        formatId: job.formatId, audioQuality: job.audioQuality,
        outDir: job.mode === 'audio' && settings.audioDir ? settings.audioDir : outDir,
        subtitle: job.subtitle || null, embedTags: job.embedTags !== false,
        trim: job.trim || null, sponsorBlock: job.sponsorBlock || null,
        splitChapters: !!job.splitChapters, liveFromStart: !!job.liveFromStart,
        concurrentFragments: job.concurrentFragments, limitRate: job.limitRate,
        useArchive: !!job.useArchive, nameTemplate: job.nameTemplate,
        playlistIndex: job.playlistIndex ?? null,
      })
    } catch (e) {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'error', error: cleanErr(e) } : j)))
    }
  }

  async function cancelJob(job) {
    if (!isDesktop) {
      clearInterval(timers.current[job.id])
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'cancelled' } : j)))
      return
    }
    try { await api().cancelDownload(job.id) } catch { /* already finished */ }
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'cancelled' } : j)))
  }

  async function pauseJob(job) {
    if (!isDesktop) {
      clearInterval(timers.current[job.id])
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'paused', speed: '', eta: '' } : j)))
      return
    }
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'paused', speed: '', eta: '' } : j)))
    try { await api().pauseDownload(job.id) } catch { /* already finished */ }
  }

  function resumeJob(job) {
    // Back into the queue; the queue runner restarts it and yt-dlp
    // continues from the .part file instead of starting over.
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'queued' } : j)))
  }

  function retryJob(job) {
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'queued', percent: 0, error: undefined } : j)))
  }

  function pauseAll() {
    jobs.filter((j) => j.status === 'downloading' || j.status === 'processing').forEach((j) => pauseJob(j))
  }
  function resumeAll() {
    setJobs((prev) => prev.map((j) => (j.status === 'paused' ? { ...j, status: 'queued' } : j)))
  }
  function moveJob(id, dir) {
    setJobs((prev) => {
      const i = prev.findIndex((j) => j.id === id)
      const k = i + dir
      if (i < 0 || k < 0 || k >= prev.length) return prev
      const copy = [...prev]
      const [it] = copy.splice(i, 1)
      copy.splice(k, 0, it)
      return copy
    })
  }

  async function doSearch() {
    const q = searchQuery.trim()
    if (!q) return
    setSearching(true); setSearchResults(null); setError('')
    try {
      if (isDesktop) {
        const data = await api().searchVideos(q, { limit: 12, cookiesBrowser: settings.cookiesBrowser })
        setSearchResults(data.entries)
      } else {
        setSearchResults([1, 2, 3].map((n) => ({
          id: `demo${n}`, title: `Demo result ${n} for "${q}"`, duration: 300 + n * 61,
          url: 'https://www.youtube.com/watch?v=demo', channel: 'Demo Channel', thumbnail: '',
        })))
      }
    } catch (e) {
      setError(cleanErr(e))
    } finally { setSearching(false) }
  }

  function openSearchResult(entry) {
    setUrl(entry.url)
    setSearchResults(null)
    probe(entry.url)
  }

  function quickDownload(entry, dlMode) {
    enqueue([{
      id: crypto.randomUUID(), url: entry.url, title: entry.title,
      mode: dlMode, height: dlMode === 'video' ? (typeof settings.defaultQuality === 'number' ? settings.defaultQuality : 720) : null,
      formatId: null, audioQuality: null, subtitle: null, embedTags: true, playlistIndex: null,
      ...jobExtras(true),
      percent: 0, speed: '', eta: '',
    }])
  }

  function redownload(item) {
    enqueue([{
      id: crypto.randomUUID(), url: item.url, title: item.title,
      mode: item.mode, height: item.mode === 'video' ? item.height : null,
      formatId: null, audioQuality: null, subtitle: null, embedTags: true, playlistIndex: null,
      ...jobExtras(true),
      percent: 0, speed: '', eta: '',
    }])
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
            : tools.demo ? (isNativeMobile ? 'Mobile preview — demo mode' : 'Browser preview — demo mode')
            : tools.yt_dlp ? `yt-dlp ${tools.version || ''} ready${tools.ffmpeg ? ' • ffmpeg ready' : ' • ffmpeg missing (needed above 720p & MP3)'}`
            : 'yt-dlp not found'}
          {isDesktop && tools && !tools.yt_dlp && (
            <button
              style={{ marginLeft: 10, background: 'var(--grad)', border: 'none', color: '#fff', borderRadius: 8, padding: '4px 12px', fontWeight: 700 }}
              onClick={async (e) => {
                e.target.textContent = 'Installing…'
                try { await api().downloadYtdlp(); setTools(await api().toolsStatus()) }
                catch { e.target.textContent = 'Install failed — check internet' }
              }}
            >Install yt-dlp</button>
          )}
        </div>
        <div className="header-actions">
          {isDesktop && tools?.yt_dlp && (
            <button className="job-btn" onClick={async (e) => {
              const b = e.target; b.textContent = 'Updating…'
              try { await api().downloadYtdlp(); setTools(await api().toolsStatus()); b.textContent = '⟳ Engine updated' }
              catch { b.textContent = 'Update failed' }
            }}>⟳ Update engine</button>
          )}
          <button className="job-btn" onClick={() => setShowSettings((s) => !s)}>⚙ {tr('settings')}</button>
          <select className="lang-sel" value={settings.lang} onChange={(e) => set({ lang: e.target.value })}>
            <option value="en">EN</option>
            <option value="bn">বাংলা</option>
          </select>
        </div>
      </header>

      {updateStatus?.state === 'ready' && (
        <div className="update-banner">
          <span>🎉 New app version {updateStatus.version || ''} is downloaded and ready.</span>
          <button className="job-btn" onClick={() => api().installUpdate()}>Restart &amp; update</button>
        </div>
      )}
      {updateStatus?.state === 'available' && (
        <div className="update-banner subtle">⬇ Downloading app update {updateStatus.version || ''} in the background…</div>
      )}

      <section className="paste-card">
        <div className="paste-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && probe()}
            placeholder={tr('pastePh')}
            spellCheck={false}
          />
          <button className="btn-fetch" onClick={probe} disabled={probing || !url.trim()}>
            {probing ? tr('fetching') : tr('fetch')}
          </button>
        </div>
        {!isDesktop && (
        <div style={{ marginTop: 14, border: '1px dashed var(--border)', borderRadius: 12, padding: '12px 14px', color: 'var(--muted)', fontSize: '.9rem' }}>
          {isNativeMobile ? (
            <>📱 You are viewing the <strong style={{ color: '#fff' }}>mobile preview</strong> — the design works here with demo data,
            but real downloads currently need the desktop app. Phone downloads are planned for a future update.</>
          ) : (
            <>🌐 You are viewing the <strong style={{ color: '#fff' }}>web preview</strong> — the full design works here with demo data,
            but real downloads need the desktop app (a browser cannot run the download engine).
            <a href="https://github.com/CodeWithRoni/Youtube-Downloader/releases" target="_blank" rel="noreferrer"
               style={{ color: '#ff5e3a', fontWeight: 700, marginLeft: 8 }}>Get the Desktop App ↓</a></>
          )}
          <div style={{ marginTop: 8 }}>
            ✨ <strong style={{ color: '#fff' }}>New in v1.2:</strong> Settings page • In-app search • Channel downloads • Trim &amp; SponsorBlock • 1000+ sites • বাংলা UI.
            Press <strong style={{ color: '#fff' }}>Fetch</strong> to try them in this demo.
          </div>
        </div>
      )}
      {error && <p className="error">⚠ {error}</p>}
        <div className="folder-row">
          <span>{tr('saveTo')}</span>
          <input value={outDir} onChange={(e) => setOutDir(e.target.value)} spellCheck={false} />
          <button onClick={pickFolder}>{tr('browse')}</button>
        </div>
        <div className="paste-row" style={{ marginTop: 10 }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder={tr('searchPh')}
            spellCheck={false}
          />
          <button className="btn-fetch" onClick={doSearch} disabled={searching || !searchQuery.trim()}>
            {searching ? '…' : `🔍 ${tr('search')}`}
          </button>
        </div>
      </section>

      {searchResults && (
        <section className="result-card">
          <div className="playlist-bar">
            <strong>{searchResults.length} results</strong>
            <button className="clear-btn" onClick={() => setSearchResults(null)}>Close</button>
          </div>
          {searchResults.map((en) => (
            <div key={en.id + en.url} className="search-row">
              {en.thumbnail ? <img src={en.thumbnail} alt="" /> : <div className="thumb-placeholder small">▶</div>}
              <div className="search-meta">
                <span className="job-title">{en.title}</span>
                <span className="muted">{en.channel} {en.duration ? '• ' + fmtDuration(en.duration) : ''}</span>
              </div>
              <button className="job-btn" onClick={() => openSearchResult(en)}>{tr('fetch')}</button>
              <button className="job-btn" onClick={() => quickDownload(en, 'video')}>⬇ Video</button>
              <button className="job-btn" onClick={() => quickDownload(en, 'audio')}>🎵 MP3</button>
            </div>
          ))}
        </section>
      )}

      {showSettings && (
        <section className="result-card">
          <h3 style={{ marginTop: 0 }}>⚙ {tr('settings')}</h3>
          <div className="settings-grid">
            <label>Language / ভাষা
              <select value={settings.lang} onChange={(e) => set({ lang: e.target.value })}>
                <option value="en">English</option>
                <option value="bn">বাংলা</option>
              </select>
            </label>
            <label>Default quality
              <select value={String(settings.defaultQuality)} onChange={(e) => set({ defaultQuality: e.target.value === 'best' ? 'best' : parseInt(e.target.value, 10) })}>
                <option value="best">Best available</option>
                {[2160, 1440, 1080, 720, 480, 360].map((h) => <option key={h} value={h}>{h}p</option>)}
              </select>
            </label>
            <label>Parallel downloads (1–5)
              <input type="number" min="1" max="5" value={settings.parallel} onChange={(e) => set({ parallel: Math.min(5, Math.max(1, parseInt(e.target.value || '2', 10))) })} />
            </label>
            <label>Speed boost — fragments (1–16)
              <input type="number" min="1" max="16" value={settings.concurrentFragments} onChange={(e) => set({ concurrentFragments: Math.min(16, Math.max(1, parseInt(e.target.value || '4', 10))) })} />
            </label>
            <label>Speed limit (e.g. 2M, 500K — empty = unlimited)
              <input type="text" value={settings.limitRate} onChange={(e) => set({ limitRate: e.target.value.trim() })} placeholder="unlimited" spellCheck={false} />
            </label>
            <label>Audio folder (optional — MP3s go elsewhere)
              <input type="text" value={settings.audioDir} onChange={(e) => set({ audioDir: e.target.value })} placeholder="Same as video folder" spellCheck={false} />
            </label>
            <label>Filename pattern
              <select value={settings.nameTemplate} onChange={(e) => set({ nameTemplate: e.target.value })}>
                <option value="title">Title only</option>
                <option value="title-quality">Title [720p]</option>
                <option value="index-title">01 - Title (playlists)</option>
              </select>
            </label>
            <label>Browser cookies (for age-restricted videos)
              <select value={settings.cookiesBrowser} onChange={(e) => set({ cookiesBrowser: e.target.value })}>
                <option value="">None</option>
                <option value="chrome">Chrome</option>
                <option value="firefox">Firefox</option>
                <option value="edge">Edge</option>
                <option value="brave">Brave</option>
                <option value="chromium">Chromium</option>
              </select>
            </label>
            <label>Channel downloads — latest videos
              <input type="number" min="1" max="100" value={settings.channelLimit} onChange={(e) => set({ channelLimit: Math.min(100, Math.max(1, parseInt(e.target.value || '20', 10))) })} />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={settings.archiveSkip} onChange={(e) => set({ archiveSkip: e.target.checked })} />
              Playlists: skip videos already downloaded before
            </label>
            <label className="check-row">
              <input type="checkbox" checked={settings.notify} onChange={(e) => set({ notify: e.target.checked })} />
              Notify when a download finishes
            </label>
          </div>
          <p className="hint">Tip: send a link straight to this app from anywhere with <code>ytdownloader://open?url=&lt;video link&gt;</code> (the app registers this on install).</p>
        </section>
      )}

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

          {((info.site && info.site !== 'youtube') || info.is_live || info.isChannel || (info.kind === 'video' && info.chapters > 0)) && (
            <div className="badge-row">
              {info.site && info.site !== 'youtube' && <span className="badge">🌐 {info.site}</span>}
              {info.is_live && <span className="badge live">🔴 LIVE</span>}
              {info.isChannel && <span className="badge">📺 Channel — latest videos</span>}
              {info.kind === 'video' && info.chapters > 0 && <span className="badge">📑 {info.chapters} chapters</span>}
            </div>
          )}
          {dup && (
            <p className="hint" style={{ color: '#ffd166' }}>⚠ You already downloaded this on {new Date(dup.finishedAt).toLocaleDateString()} — see History below.</p>
          )}
          {info.kind === 'video' && info.id && (!info.site || info.site === 'youtube') && (
            <details className="preview">
              <summary>▶ Preview</summary>
              <div className="preview-frame">
                <iframe src={`https://www.youtube.com/embed/${info.id}`} title="Video preview" allow="encrypted-media" allowFullScreen />
              </div>
            </details>
          )}

          <div className="mode-toggle">
            <button className={mode === 'video' ? 'active' : ''} onClick={() => setMode('video')}>{tr('video')}</button>
            <button className={mode === 'audio' ? 'active' : ''} onClick={() => setMode('audio')}>{tr('audio')}</button>
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
              <div className="sub-row">
                <span>{tr('subtitles')}</span>
                {(() => {
                  const list = info.kind === 'video' ? (info.subtitle_options || []) : GENERIC_SUBS
                  return list.length ? (
                    <select value={subKey} onChange={(e) => setSubKey(e.target.value)}>
                      <option value="">None</option>
                      {list.map((s) => (
                        <option key={subKeyOf(s)} value={subKeyOf(s)}>{s.label}</option>
                      ))}
                    </select>
                  ) : <span className="muted">not available for this video</span>
                })()}
                {subKey && (
                  <label className="sub-embed">
                    <input type="checkbox" checked={subEmbed} onChange={(e) => setSubEmbed(e.target.checked)} />
                    Embed in video (otherwise a separate .srt file)
                  </label>
                )}
              </div>
              <div className="extras">
                {info.kind === 'video' && (
                  <>
                    <div className="extra-row">
                      <span>✂ Trim:</span>
                      <input className="time-in" value={trimStart} onChange={(e) => setTrimStart(e.target.value)} placeholder="Start 0:00" spellCheck={false} />
                      <input className="time-in" value={trimEnd} onChange={(e) => setTrimEnd(e.target.value)} placeholder="End 1:30" spellCheck={false} />
                      <span className="muted">mm:ss — empty = full video</span>
                    </div>
                    {info.chapters > 0 && (
                      <label className="sub-embed">
                        <input type="checkbox" checked={splitCh} onChange={(e) => setSplitCh(e.target.checked)} />
                        Split into {info.chapters} chapter files
                      </label>
                    )}
                    {info.is_live && (
                      <label className="sub-embed">
                        <input type="checkbox" checked={liveChk} onChange={(e) => setLiveChk(e.target.checked)} />
                        🔴 Livestream — record from the beginning
                      </label>
                    )}
                  </>
                )}
                <div className="extra-row">
                  <span>SponsorBlock:</span>
                  <select value={sponsorSel} onChange={(e) => setSponsorSel(e.target.value)}>
                    <option value="">Off</option>
                    <option value="remove">Remove sponsor / intro / outro segments</option>
                    <option value="mark">Mark them as chapters</option>
                  </select>
                </div>
              </div>
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
              <label className="sub-embed" style={{ marginTop: 10 }}>
                <input type="checkbox" checked={embedTags} onChange={(e) => setEmbedTags(e.target.checked)} />
                Add cover art &amp; song info (tags) to the MP3
              </label>
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

          <div className="extra-row" style={{ marginBottom: 12 }}>
            <span>🕐 Start at (optional):</span>
            <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
            {scheduleAt && <button className="job-btn" onClick={() => setScheduleAt('')}>Clear</button>}
          </div>
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
          <div className="playlist-bar">
            <h3 style={{ margin: 0 }}>{tr('downloads')}</h3>
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="clear-btn" onClick={pauseAll}>{tr('pauseAll')}</button>
              <button className="clear-btn" onClick={resumeAll}>{tr('resumeAll')}</button>
            </span>
          </div>
          {jobs.map((j) => (
            <div key={j.id} className="job">
              <div className="job-top">
                <span className="job-title">{j.title}</span>
                <span className={`job-status ${j.status}`}>
                  {j.status === 'queued' && tr('queued')}
                  {j.status === 'scheduled' && `🕐 ${new Date(j.runAt).toLocaleString()}`}
                  {j.status === 'downloading' && `${j.percent || 0}% • ${j.speed || ''} ${j.eta ? '• ETA ' + j.eta : ''}`}
                  {j.status === 'processing' && 'Processing (merging / converting)…'}
                  {j.status === 'paused' && `${tr('paused')} • ${Math.floor(j.percent || 0)}%`}
                  {j.status === 'done' && `✓ Done${j.sizeBytes ? ' • ' + fmtBytes(j.sizeBytes) : ''}`}
                  {j.status === 'error' && `✗ ${j.error || 'Failed'}`}
                  {j.status === 'cancelled' && 'Cancelled'}
                </span>
              </div>
              <div className="job-bar">
                <div className={`job-fill ${j.status}`} style={{ width: `${j.status === 'done' ? 100 : j.percent || 0}%` }} />
              </div>
              <div className="job-actions">
                {j.status === 'queued' && (
                  <>
                    <button className="job-btn" onClick={() => moveJob(j.id, -1)}>↑</button>
                    <button className="job-btn" onClick={() => moveJob(j.id, 1)}>↓</button>
                  </>
                )}
                {(j.status === 'downloading' || j.status === 'processing') && (
                  <button className="job-btn" onClick={() => pauseJob(j)}>{tr('pause')}</button>
                )}
                {j.status === 'paused' && (
                  <button className="job-btn" onClick={() => resumeJob(j)}>{tr('resume')}</button>
                )}
                {j.status === 'error' && (
                  <button className="job-btn" onClick={() => retryJob(j)}>{tr('retry')}</button>
                )}
                {j.status === 'done' && j.filePath && isDesktop && (
                  <>
                    <button className="job-btn" onClick={() => api().openFile(j.filePath)}>{tr('openFile')}</button>
                    <button className="job-btn" onClick={() => api().showInFolder(j.filePath)}>{tr('folder')}</button>
                  </>
                )}
                {(j.status === 'downloading' || j.status === 'queued' || j.status === 'processing' || j.status === 'paused') && (
                  <button className="job-cancel" onClick={() => cancelJob(j)}>{tr('cancel')}</button>
                )}
              </div>
            </div>
          ))}
          <button className="clear-btn" onClick={() => setJobs((prev) => prev.filter((j) => ['downloading', 'processing', 'queued'].includes(j.status)))}>
            {tr('clearFinished')}
          </button>
        </section>
      )}

      {history.length > 0 && (
        <section className="jobs-card">
          <div className="playlist-bar">
            <h3 style={{ margin: 0 }}>{tr('history')}</h3>
            <span className="muted">{history.length} downloads{fmtBytes(history.reduce((a, h) => a + (h.sizeBytes || 0), 0)) ? ' • ' + fmtBytes(history.reduce((a, h) => a + (h.sizeBytes || 0), 0)) + ' total' : ''}</span>
            <button className="clear-btn" onClick={() => setHistory([])}>{tr('clearAll')}</button>
          </div>
          {history.map((h) => (
            <div key={h.jobId} className="job">
              <div className="job-top">
                <span className="job-title">{h.title}</span>
                <span className="job-status done">
                  {new Date(h.finishedAt).toLocaleString()} • {h.mode === 'video' ? `Video${h.height ? ' ' + h.height + 'p' : ''}` : 'Audio MP3'}{h.sizeBytes ? ' • ' + fmtBytes(h.sizeBytes) : ''}
                </span>
              </div>
              <div className="job-actions">
                {h.filePath && isDesktop && (
                  <>
                    <button className="job-btn" onClick={() => api().openFile(h.filePath)}>{tr('openFile')}</button>
                    <button className="job-btn" onClick={() => api().showInFolder(h.filePath)}>{tr('folder')}</button>
                  </>
                )}
                <button className="job-btn" onClick={() => redownload(h)}>{tr('downloadAgain')}</button>
                <button className="job-cancel" onClick={() => setHistory((prev) => prev.filter((x) => x.jobId !== h.jobId))}>{tr('remove')}</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <footer>For personal use only — please respect creators' copyright and YouTube's terms. Built with Electron + React + yt-dlp. • v1.2</footer>
    </div>
  )
}
