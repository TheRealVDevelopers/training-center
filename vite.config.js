import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `--host` is set in the npm script so other devices (phones on the same
// wifi) can open the scanner page at http://<your-laptop-ip>:5173/scan
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
})
