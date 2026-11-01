import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

function redirectLocalhost() {
  function redirect(req, res, next, fallbackPort) {
    const host = String(req.headers.host || '')
    if (host === 'localhost' || host.startsWith('localhost:')) {
      const port = host.includes(':') ? host.split(':')[1] : fallbackPort
      res.statusCode = 307
      res.setHeader('Location', `http://127.0.0.1:${port}${req.url}`)
      res.end()
      return
    }
    next()
  }
  return {
    name: 'redirect-localhost-to-127-0-0-1',
    configureServer(server) {
      server.middlewares.use((req, res, next) => redirect(req, res, next, '5173'))
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => redirect(req, res, next, '4173'))
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), redirectLocalhost()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: './src/test/setup.js',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
  build: {
    chunkSizeWarningLimit: 700,
  },
})
