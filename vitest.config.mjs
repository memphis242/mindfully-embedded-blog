import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['functions/**/*.js', 'scripts/**/*.js', 'public/js/**/*.js'],
    },
  },
});
