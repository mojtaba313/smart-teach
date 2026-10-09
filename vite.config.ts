import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    // The studio, the bank and the presenter already split into their own
    // chunks; what is left is React + KaTeX + framer-motion + dnd-kit + the
    // icon set, which is a fair trade for a tool that runs entirely offline.
    chunkSizeWarningLimit: 700,
  },
})
