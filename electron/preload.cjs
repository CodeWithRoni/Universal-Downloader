// YouTube Downloader — preload bridge.
// Exposes a small, safe API to the renderer as window.desktopAPI.
// (In a plain browser there is no preload, so window.desktopAPI is
// undefined and the UI runs in demo mode.)
'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopAPI', {
  getInfo: (url) => ipcRenderer.invoke('get-info', url),
  startDownload: (params) => ipcRenderer.invoke('start-download', params),
  cancelDownload: (id) => ipcRenderer.invoke('cancel-download', id),
  toolsStatus: () => ipcRenderer.invoke('tools-status'),
  defaultDownloadDir: () => ipcRenderer.invoke('default-download-dir'),
  downloadYtdlp: () => ipcRenderer.invoke('download-ytdlp'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  onProgress: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('download-progress', handler)
    return () => ipcRenderer.removeListener('download-progress', handler)
  },
})
