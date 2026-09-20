import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const proxy = Object.fromEntries(
  ['/api', '/status', '/health'].map((prefix) => [
    prefix,
    {
      target:
        'http://' +
        (process.env.HOST === '0.0.0.0'
          ? '127.0.0.1'
          : process.env.HOST || '127.0.0.1') +
        ':' +
        (process.env.PORT || '18080'),
      changeOrigin: true,
    },
  ]),
);
export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.WEB_HOST || '127.0.0.1',
    port: Number(process.env.VITE_PORT || 2711),
    strictPort: true,
    proxy,
  },
  preview: {
    host: process.env.WEB_HOST || '127.0.0.1',
    port: Number(process.env.VITE_PORT || 2711),
    strictPort: true,
    proxy,
  },
});
