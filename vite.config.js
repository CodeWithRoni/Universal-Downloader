import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Electron loads the built files from disk (file://), so the default base
// must be relative ('./'). The GitHub Pages web build sets
// VITE_BASE=/Youtube-Downloader/ (the repo name) in its workflow.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || './',
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'es2021' },
})
