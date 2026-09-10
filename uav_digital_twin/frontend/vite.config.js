import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server proxies the FastAPI backend so the browser only ever talks to
// one origin (no CORS setup needed on the backend):
//   /api/*  -> http://127.0.0.1:8000/*        (REST, e.g. /api/latest-sensor-data)
//   /ws/*   -> ws://127.0.0.1:8000/ws/*       (WebSocket live stream)
// Point at a different backend with BACKEND_URL=http://host:port in frontend/.env
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.BACKEND_URL || 'http://127.0.0.1:8000'

  const proxy = {
    '/api': {
      target: backend,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
    '/ws': {
      target: backend.replace(/^http/, 'ws'),
      ws: true,
    },
  }

  return {
    plugins: [react()],
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
  }
})
