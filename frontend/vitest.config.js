import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '../build/vitest',
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'html', 'json-summary'],
    },
  },
});
