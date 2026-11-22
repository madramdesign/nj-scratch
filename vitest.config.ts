import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      { extends: true, test: { name: 'node', include: ['packages/*/test/**/*.test.ts', 'apps/api/test/**/*.test.ts'], environment: 'node' } },
      { extends: true, test: { name: 'web', include: ['apps/web/test/**/*.test.tsx'], environment: 'jsdom', setupFiles: ['apps/web/test/setup.ts'] } },
    ],
  },
});
