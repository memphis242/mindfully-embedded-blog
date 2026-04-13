import { initWriteSession, loadTurnstile } from './main-app.js';

export function normalizeConsent(raw) {
  return raw === true || raw === 'true' || raw === 'on';
}

export function buildLeadPayload(form) {
  const formData = new FormData(form);
  const payload = {
    serviceType: String(form.dataset.serviceType || '').trim(),
    name: String(formData.get('name') || '').trim(),
    email: String(formData.get('email') || '')
      .trim()
      .toLowerCase(),
    message: String(formData.get('message') || '').trim(),
    consent: normalizeConsent(formData.get('consent')),
  };
  return payload;
}

export function renderLeadFeedback(node, text, isError = false) {
  if (!node) return;
  node.textContent = text;
  node.dataset.state = isError ? 'error' : 'ok';
}

export async function initLeadIntakePage(doc = document, fetchImpl = fetch, win = window) {
  const form = doc.querySelector('[data-lead-form]');
  if (!form) return;

  const feedback = doc.querySelector('[data-lead-feedback]');
  const turnstileWrap = doc.querySelector('[data-lead-turnstile]');
  const state = { turnstileToken: null };

  const siteKey = String(doc.querySelector('meta[name="meb-turnstile-site-key"]')?.content || '').trim();
  if (siteKey) {
    loadTurnstile(siteKey, turnstileWrap, state, doc, win);
  } else {
    renderLeadFeedback(
      feedback,
      'Submission is disabled until Turnstile site key is configured.',
      true
    );
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!state.turnstileToken) {
      renderLeadFeedback(
        feedback,
        'Request submission is blocked until Turnstile verification is complete.',
        true
      );
      return;
    }

    const payload = buildLeadPayload(form);
    payload.turnstileToken = state.turnstileToken;

    try {
      await initWriteSession(fetchImpl);

      const response = await fetchImpl('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const outcome = await response.json();
      if (!response.ok || !outcome.ok) {
        throw new Error(outcome.error || 'lead_submit_failed');
      }

      form.reset();
      state.turnstileToken = null;
      renderLeadFeedback(feedback, 'Request submitted successfully. I will respond within 48 hours.');
    } catch (err) {
      renderLeadFeedback(feedback, `Submission failed: ${err.message}`, true);
    }
  });
}
