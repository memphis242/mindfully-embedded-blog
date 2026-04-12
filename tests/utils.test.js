import { describe, expect, it } from 'vitest';
import {
  firstPassModeration,
  generateFunnyName,
  markdownToSafeHtml,
  validateDisplayName,
} from '../functions/_lib/utils.js';

describe('validateDisplayName', () => {
  it('accepts valid names', () => {
    const out = validateDisplayName('calm-debugger');
    expect(out.ok).toBe(true);
    expect(out.value).toBe('calm-debugger');
  });

  it('rejects invalid charset', () => {
    const out = validateDisplayName('bad<script>');
    expect(out.ok).toBe(false);
  });
});

describe('firstPassModeration', () => {
  it('holds link-dense payloads', () => {
    const out = firstPassModeration(
      'a https://a.com b https://b.com c https://c.com d https://d.com'
    );
    expect(out.status).toBe('held');
    expect(out.reason).toBe('link_density');
  });

  it('passes normal payloads', () => {
    const out = firstPassModeration('Looks good to me.');
    expect(out.status).toBe('visible');
  });
});

describe('markdownToSafeHtml', () => {
  it('escapes html tags', () => {
    const out = markdownToSafeHtml('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
  });
});

describe('generateFunnyName', () => {
  it('returns adjective-noun pattern', () => {
    const out = generateFunnyName();
    expect(out).toMatch(/^[a-z]+-[a-z]+$/);
  });
});
