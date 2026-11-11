import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // One vendor chunk: keeps the Vue runtime out of the app entry.
        manualChunks(id) {
          if (id.includes('node_modules/vue/') || id.includes('node_modules/@vue/')) {
            return 'vendor'
          }
          return null
        },
      },
    },
  },
})
