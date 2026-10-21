import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  build: {
    target: 'es2022',
    // Desktop app loading from disk: one bundle is fine (three.js is most of it).
    chunkSizeWarningLimit: 1000,
  },
})
