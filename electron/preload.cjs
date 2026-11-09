// Universal Downloader — preload bridge.
// Exposes a small, safe API to the renderer as window.desktopAPI.
// (In a plain browser there is no preload, so window.desktopAPI is
// undefined and the UI runs in demo mode.)
'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopAPI', {
  getInfo: (url, opts) => ipcRenderer.invoke('get-info', url, opts),
  searchVideos: (query, opts) => ipcRenderer.invoke('search-videos', query, opts),
  startDownload: (params) => ipcRenderer.invoke('start-download', params),
  cancelDownload: (id) => ipcRenderer.invoke('cancel-download', id),
  pauseDownload: (id) => ipcRenderer.invoke('pause-download', id),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  toolsStatus: () => ipcRenderer.invoke('tools-status'),
  defaultDownloadDir: () => ipcRenderer.invoke('default-download-dir'),
  downloadYtdlp: () => ipcRenderer.invoke('download-ytdlp'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  onProgress: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('download-progress', handler)
    return () => ipcRenderer.removeListener('download-progress', handler)
  },
  onExternalLink: (callback) => {
    const handler = (_event, link) => callback(link)
    ipcRenderer.on('external-link', handler)
    return () => ipcRenderer.removeListener('external-link', handler)
  },
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status)
    ipcRenderer.on('update-status', handler)
    return () => ipcRenderer.removeListener('update-status', handler)
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
})
