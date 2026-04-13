import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  initWriteSession: vi.fn(),
  loadTurnstile: vi.fn(),
}));

vi.mock('../../public/js/modules/main-app.js', () => ({
  initWriteSession: deps.initWriteSession,
  loadTurnstile: deps.loadTurnstile,
}));

import {
  buildLeadPayload,
  initLeadIntakePage,
  normalizeConsent,
  renderLeadFeedback,
} from '../../public/js/modules/leads-app.js';

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

describe('leads-app module', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    deps.initWriteSession.mockReset();
    deps.loadTurnstile.mockReset();
    deps.initWriteSession.mockResolvedValue(undefined);
  });

  it('covers consent normalization and payload building', () => {
    expect(normalizeConsent(true)).toBe(true);
    expect(normalizeConsent('true')).toBe(true);
    expect(normalizeConsent('on')).toBe(true);
    expect(normalizeConsent('off')).toBe(false);

    document.body.innerHTML = `
      <form data-lead-form data-service-type="training">
        <input name="name" value="  Alex  " />
        <input name="email" value=" A@EXAMPLE.COM " />
        <textarea name="message">  Hello world  </textarea>
        <input name="consent" type="checkbox" checked />
      </form>
    `;
    const payload = buildLeadPayload(document.querySelector('form'));
    expect(payload).toEqual({
      serviceType: 'training',
      name: 'Alex',
      email: 'a@example.com',
      message: 'Hello world',
      consent: true,
    });

    document.body.innerHTML = `
      <form data-lead-form>
        <input name="name" value="" />
        <input name="email" value="" />
        <textarea name="message"></textarea>
      </form>
    `;
    const fallback = buildLeadPayload(document.querySelector('form'));
    expect(fallback).toEqual({
      serviceType: '',
      name: '',
      email: '',
      message: '',
      consent: false,
    });
  });

  it('renderLeadFeedback safely no-ops without node and sets states', () => {
    expect(() => renderLeadFeedback(null, 'x')).not.toThrow();
    const node = document.createElement('p');
    renderLeadFeedback(node, 'ok');
    expect(node.textContent).toBe('ok');
    expect(node.dataset.state).toBe('ok');
    renderLeadFeedback(node, 'err', true);
    expect(node.dataset.state).toBe('error');
  });

  it('initLeadIntakePage no-ops without form', async () => {
    await initLeadIntakePage(document, vi.fn(), window);
    expect(deps.loadTurnstile).not.toHaveBeenCalled();
  });

  it('handles missing site key and blocked submit without token', async () => {
    document.body.innerHTML = `
      <form data-lead-form data-service-type="training" class="comment-form">
        <input name="name" value="Alex" />
        <input name="email" value="a@example.com" />
        <textarea name="message">hello world message</textarea>
        <input name="consent" type="checkbox" checked />
        <button type="submit">Send</button>
      </form>
      <div data-lead-turnstile></div>
      <p data-lead-feedback></p>
    `;
    await initLeadIntakePage(document, vi.fn(), window);
    expect(document.querySelector('[data-lead-feedback]').textContent).toContain('disabled');

    document
      .querySelector('[data-lead-form]')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(document.querySelector('[data-lead-feedback]').textContent).toContain('blocked');
  });

  it('submits successfully when token exists', async () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'meb-turnstile-site-key');
    meta.setAttribute('content', 'site-key');
    document.head.appendChild(meta);

    document.body.innerHTML = `
      <form data-lead-form data-service-type="consulting" class="comment-form">
        <input name="name" value="Alex" />
        <input name="email" value="a@example.com" />
        <textarea name="message">hello world message</textarea>
        <input name="consent" type="checkbox" checked />
        <button type="submit">Send</button>
      </form>
      <div data-lead-turnstile></div>
      <p data-lead-feedback></p>
    `;

    const fetchMock = vi.fn(async (url) => {
      if (url === '/api/leads') return jsonResponse({ ok: true, leadId: 'l1' });
      return jsonResponse({});
    });
    deps.loadTurnstile.mockImplementation((_k, _w, state) => {
      state.turnstileToken = 'tok';
    });

    await initLeadIntakePage(document, fetchMock, window);
    document
      .querySelector('[data-lead-form]')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.initWriteSession).toHaveBeenCalledWith(fetchMock);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/leads',
      expect.objectContaining({ method: 'POST' })
    );
    expect(document.querySelector('[data-lead-feedback]').textContent).toContain('within 48 hours');
  });

  it('handles backend and session-init failures with fallback error text', async () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'meb-turnstile-site-key');
    meta.setAttribute('content', 'site-key');
    document.head.appendChild(meta);

    document.body.innerHTML = `
      <form data-lead-form data-service-type="contracts" class="comment-form">
        <input name="name" value="Alex" />
        <input name="email" value="a@example.com" />
        <textarea name="message">hello world message</textarea>
        <input name="consent" type="checkbox" checked />
        <button type="submit">Send</button>
      </form>
      <div data-lead-turnstile></div>
      <p data-lead-feedback></p>
    `;

    const fetchMock = vi.fn(async (url) => {
      if (url === '/api/leads') return jsonResponse({ ok: false }, false, 500);
      return jsonResponse({});
    });
    deps.loadTurnstile.mockImplementation((_k, _w, state) => {
      state.turnstileToken = 'tok';
    });

    await initLeadIntakePage(document, fetchMock, window);
    const form = document.querySelector('[data-lead-form]');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-lead-feedback]').textContent).toContain('lead_submit_failed');

    deps.initWriteSession.mockRejectedValueOnce(new Error('session_init_failed'));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-lead-feedback]').textContent).toContain('session_init_failed');
  });
});
