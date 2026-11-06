import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        // The pad, the garden, and the capture studio (headless modes only).
        input: {
          pad: resolve(__dirname, 'src/renderer/pad.html'),
          garden: resolve(__dirname, 'src/renderer/garden.html'),
          studio: resolve(__dirname, 'src/renderer/studio.html')
        }
      }
    }
  }
})
