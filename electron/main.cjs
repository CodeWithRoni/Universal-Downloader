// YouTube Downloader — Electron main process.
// Thin wiring only: window creation + IPC handlers that delegate to
// core.cjs (all the real logic lives there and is plain Node.js).
'use strict'

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, Tray, nativeImage } = require('electron')
const path = require('path')
const core = require('./core.cjs')

let win = null

function binDirs() {
  const dirs = []
  if (app.isPackaged) {
    // Installers bundle yt-dlp + ffmpeg under resources/bin.
    dirs.push(path.join(process.resourcesPath, 'bin'))
  } else {
    // Dev: scripts/fetch-binaries.sh puts them in resources/bin.
    dirs.push(path.join(__dirname, '..', 'resources', 'bin'))
  }
  // Copy the app downloaded itself on first run.
  dirs.push(path.join(app.getPath('userData'), 'bin'))
  return dirs
}

function findTool(base) {
  return core.findBinary(base, binDirs())
}

function ytdlpOrThrow() {
  const bin = findTool('yt-dlp')
  if (!bin) {
    throw new Error(
      'yt-dlp not found. Use the "Install yt-dlp" button or install yt-dlp on your system PATH.',
    )
  }
  return bin
}

function createWindow() {
  win = new BrowserWindow({
    width: 940,
    height: 780,
    minWidth: 680,
    minHeight: 560,
    title: 'YouTube Downloader',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const devUrl = process.env.ELECTRON_DEV_URL
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
  win.webContents.on('did-finish-load', () => {
    if (pendingLink) {
      win.webContents.send('external-link', pendingLink)
      pendingLink = null
    }
  })
}

// ---------------------------------------------------------------------------
// Deep links: ytdownloader://open?url=<encoded video link>
// Lets other apps / a browser bookmarklet hand a link straight to the app.
// ---------------------------------------------------------------------------
let pendingLink = null

function extractDeepLink(raw) {
  if (!raw || typeof raw !== 'string' || !raw.startsWith('ytdownloader://')) return null
  try {
    const u = new URL(raw)
    const q = u.searchParams.get('url')
    if (q) return q
    const rest = raw.slice('ytdownloader://'.length)
    if (/^(www\.)?youtube\.com\//.test(rest) || /^youtu\.be\//.test(rest)) return `https://${rest}`
  } catch { /* not a usable link */ }
  return null
}

function sendExternalLink(link) {
  if (!link) return
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send('external-link', link)
  } else {
    pendingLink = link
  }
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('ytdownloader', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('ytdownloader')
}
app.on('open-url', (event, url) => {
  event.preventDefault()
  const link = extractDeepLink(url)
  if (link) sendExternalLink(link)
})

// ---------------------------------------------------------------------------
// Tray icon + auto-update
// ---------------------------------------------------------------------------
let tray = null
function createTray() {
  try {
    const icon = nativeImage
      .createFromPath(path.join(__dirname, '..', 'build', 'icon.png'))
      .resize({ width: 18, height: 18 })
    tray = new Tray(icon)
    tray.setToolTip('YouTube Downloader')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Open YouTube Downloader',
          click: () => {
            if (win && !win.isDestroyed()) { win.show(); win.focus() } else createWindow()
          },
        },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ]),
    )
    tray.on('click', () => {
      if (win && !win.isDestroyed()) { win.show(); win.focus() }
    })
  } catch { /* tray not supported in this environment */ }
}

function setupAutoUpdate() {
  if (!app.isPackaged) return
  try {
    const { autoUpdater } = require('electron-updater')
    const send = (state, extra) => {
      if (win && !win.isDestroyed()) win.webContents.send('update-status', { state, ...(extra || {}) })
    }
    autoUpdater.on('update-available', (info) => send('available', { version: info && info.version }))
    autoUpdater.on('update-downloaded', (info) => send('ready', { version: info && info.version }))
    autoUpdater.on('error', () => send('error'))
    ipcMain.handle('install-update', async () => {
      try { autoUpdater.quitAndInstall() } catch { /* nothing to install */ }
    })
    autoUpdater.checkForUpdates().catch(() => {})
  } catch { /* updater unavailable (e.g. no publish config yet) */ }
}

// ---------------------------------------------------------------------------
// Boot (single instance — a second launch just focuses / hands over a link)
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const link = (argv || []).map(extractDeepLink).find(Boolean)
    if (link) {
      sendExternalLink(link)
    } else if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    createWindow()
    createTray()
    setupAutoUpdate()
    const initial = (process.argv || []).map(extractDeepLink).find(Boolean)
    if (initial) pendingLink = initial
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ---------------------------------------------------------------------------
// IPC — the renderer calls these through preload.cjs (window.desktopAPI)
// ---------------------------------------------------------------------------

ipcMain.handle('tools-status', async () => {
  const yt = findTool('yt-dlp')
  const ff = findTool('ffmpeg')
  return {
    yt_dlp: !!yt,
    ffmpeg: !!ff,
    version: yt ? core.toolVersion(yt) : null,
  }
})

ipcMain.handle('default-download-dir', async () => app.getPath('downloads'))

ipcMain.handle('download-ytdlp', async () =>
  core.downloadYtdlp(path.join(app.getPath('userData'), 'bin')),
)

ipcMain.handle('get-info', async (_event, url, opts) => core.getInfo(ytdlpOrThrow(), url, opts || {}))

ipcMain.handle('search-videos', async (_event, query, opts) =>
  core.searchVideos(ytdlpOrThrow(), query, opts || {}),
)

ipcMain.handle('start-download', async (_event, p) => {
  const bin = ytdlpOrThrow()
  const args = core.buildDownloadArgs({
    ...p,
    ffmpegPath: findTool('ffmpeg'),
    archivePath: p.useArchive ? path.join(app.getPath('userData'), 'download-archive.txt') : null,
  })
  await core.startDownloadProcess({
    binPath: bin,
    args,
    url: p.url,
    id: p.id,
    onProgress: (payload) => {
      if (win && !win.isDestroyed()) win.webContents.send('download-progress', payload)
    },
  })
})

ipcMain.handle('cancel-download', async (_event, id) => {
  core.cancelDownload(id)
})

ipcMain.handle('pause-download', async (_event, id) => {
  core.pauseDownload(id)
})

ipcMain.handle('open-file', async (_event, filePath) => {
  if (filePath) await shell.openPath(filePath)
})

ipcMain.handle('show-in-folder', async (_event, filePath) => {
  if (filePath) shell.showItemInFolder(filePath)
})

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})
