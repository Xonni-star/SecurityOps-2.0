/// <reference types="vitest/config" />
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    return {
      server: {
        proxy: {
          //Target your Node.js backend
          '/api-proxy': 'http://localhost:5000',
          '/ws-proxy': {target: 'ws://localhost:5000', ws: true},
          // SecurityOps TypeScript backend (frontend/backend)
          '/api/v1': {
            target: process.env.API_BACKEND_URL || 'http://localhost:8000',
            changeOrigin: true,
          },
        },
      },
      plugins: react(),
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      test: {
        environment: 'jsdom',
        include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
        exclude: ['node_modules', 'dist'],
        globals: false,
      },
    };
});
