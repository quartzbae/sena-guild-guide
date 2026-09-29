import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 프로젝트 주소: https://quartzbae.github.io/sena-guild-guide/
export default defineConfig({
  plugins: [react()],
  base: '/sena-guild-guide/',
})
