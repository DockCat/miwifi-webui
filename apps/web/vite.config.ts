import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';

const port = Number(process.env.WEB_PORT ?? 5173);

const config: UserConfig = {
  plugins: [react()],
  server: {
    port,
    strictPort: true,
    proxy: {
      // Frontend never talks to the router; it talks to our backend.
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3001',
        changeOrigin: false
      }
    }
  }
};

export default defineConfig(config);
