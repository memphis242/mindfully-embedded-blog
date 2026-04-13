import { describe, expect, it, vi } from 'vitest';

const initLeadIntakePage = vi.fn();

vi.mock('../../public/js/modules/leads-app.js', () => ({
  initLeadIntakePage,
}));

describe('leads.js entrypoint', () => {
  it('calls initLeadIntakePage on import', async () => {
    vi.resetModules();
    initLeadIntakePage.mockClear();
    await import('../../public/js/leads.js');
    expect(initLeadIntakePage).toHaveBeenCalledOnce();
  });
});
