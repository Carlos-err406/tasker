import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import electron from 'vite-plugin-electron/simple';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Load apps/desktop/.env (all vars, no prefix filter). Baked into the main
  // process bundle via `define` so the packaged app has sync credentials.
  const env = loadEnv(mode, __dirname, '');
  const syncDefine = {
    'process.env.TASKER_SUPABASE_URL': JSON.stringify(env.TASKER_SUPABASE_URL ?? ''),
    'process.env.TASKER_SUPABASE_KEY': JSON.stringify(env.TASKER_SUPABASE_KEY ?? ''),
  };

  return {
  plugins: [
    tailwindcss(),
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          define: syncDefine,
          build: {
            rollupOptions: {
              external: ['better-sqlite3', 'eventkit-node', /\.node$/, /^@supabase\//, 'ws'],
            },
          },
          resolve: {
            alias: {
              '@': path.resolve(__dirname, './src'),
              '@electron': path.resolve(__dirname, './electron'),
              '@utils': path.resolve(__dirname, './utils'),
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            rollupOptions: {
              external: ['better-sqlite3', 'eventkit-node', /\.node$/],
            },
          },
          resolve: {
            alias: {
              '@': path.resolve(__dirname, './src'),
              '@electron': path.resolve(__dirname, './electron'),
              '@utils': path.resolve(__dirname, './utils'),
            },
          },
        },
      },
      renderer: process.env.NODE_ENV === 'test' ? undefined : {},
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@electron': path.resolve(__dirname, './electron'),
      '@utils': path.resolve(__dirname, './utils'),
    },
  },
  };
});
