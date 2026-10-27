import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev` proxies the kiosk server's routes to a running container on :8090.
const server = 'http://localhost:8090'

export default defineConfig({
  plugins: [react()],
  // Wall iPads are often a few iOS versions behind; Vite's default (Safari 16.4) left syntax an
  // older Safari cannot parse, and the page stayed black. Built-ins are covered in index.html.
  build: { target: ['es2019', 'safari13'] },
  server: { proxy: { '/k': server, '/enroll': server, '/exercise-media': server } },
})
