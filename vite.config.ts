import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

function proxyToServer() {
  return {
    target: 'http://localhost:3101',
    changeOrigin: true,
    secure: false,
  }
}

export default defineConfig(({ mode }) => ({
  base: '/FP/',
  plugins: [
    react({
      babel: {
        plugins: mode === 'development' ? ['react-dev-locator'] : [],
      },
    }),
    tsconfigPaths(),
  ],
  server: {
    proxy: {
      '/api': proxyToServer(),
      '/uploads': proxyToServer(),
      '/exports': proxyToServer(),
    },
  },
}))
