import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri desktop build uses base '/'. The GitHub Pages web build sets
// VITE_BASE=/Youtube-Downloader/ (the repo name) in its workflow.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/',
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'es2021' },
})
