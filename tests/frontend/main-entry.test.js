import { describe, expect, it, vi } from 'vitest';

const startApp = vi.fn();

vi.mock('../../public/js/modules/main-app.js', () => ({
  startApp,
}));

describe('main.js entrypoint', () => {
  it('calls startApp on module import', async () => {
    vi.resetModules();
    startApp.mockClear();
    await import('../../public/js/main.js');
    expect(startApp).toHaveBeenCalledOnce();
  });
});
