import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext' // Wichtig für moderne Bibliotheken wie pdf.js
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    }
  }
})