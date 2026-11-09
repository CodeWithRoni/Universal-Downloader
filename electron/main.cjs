// YouTube Downloader — Electron main process.
// Thin wiring only: window creation + IPC handlers that delegate to
// core.cjs (all the real logic lives there and is plain Node.js).
'use strict'

const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron')
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
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

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

ipcMain.handle('get-info', async (_event, url) => core.getInfo(ytdlpOrThrow(), url))

ipcMain.handle('start-download', async (_event, p) => {
  const bin = ytdlpOrThrow()
  const args = core.buildDownloadArgs({ ...p, ffmpegPath: findTool('ffmpeg') })
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
