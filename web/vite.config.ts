import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BASE_PATH diisi otomatis oleh GitHub Actions: "/<nama-repo>/"
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || '/',
})
