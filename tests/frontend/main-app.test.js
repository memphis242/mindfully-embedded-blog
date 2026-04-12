import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as app from '../../public/js/modules/main-app.js';

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

describe('main-app module', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.body.removeAttribute('data-bg-image');
    document.body.removeAttribute('data-page-id');
    delete window.turnstile;
    vi.restoreAllMocks();
  });

  it('applySectionBackground sets background variable and image', () => {
    document.body.dataset.bgImage = '/assets/bg.svg';
    const bg = document.createElement('div');
    bg.className = 'parallax-bg';
    document.body.appendChild(bg);

    app.applySectionBackground(document);

    expect(bg.style.getPropertyValue('--section-bg')).toContain('/assets/bg.svg');
    expect(bg.style.backgroundImage).toContain('/assets/bg.svg');
  });

  it('initParallax exits when reduced motion is enabled', () => {
    const win = { addEventListener: vi.fn() };
    app.initParallax(win, document, true);
    expect(win.addEventListener).not.toHaveBeenCalled();
  });

  it('initParallax exits when background node is missing', () => {
    const win = {
      addEventListener: vi.fn(),
      matchMedia: vi.fn(() => ({ matches: false })),
    };
    app.initParallax(win, document);
    expect(win.addEventListener).not.toHaveBeenCalled();
  });

  it('initParallax updates transform on scroll', () => {
    const bg = document.createElement('div');
    bg.className = 'parallax-bg';
    document.body.appendChild(bg);

    let handler = null;
    const win = {
      scrollY: 100,
      requestAnimationFrame: (cb) => cb(),
      addEventListener: (_name, cb) => {
        handler = cb;
      },
    };

    app.initParallax(win, document, false);
    handler();

    expect(bg.style.transform).toContain('14.000000000000002px');
  });

  it('renderLatestArticles renders latest 3 cards', async () => {
    document.body.innerHTML = '<div id="latest-articles"></div>';
    const fetchMock = vi.fn(async () =>
      jsonResponse([
        { title: 'A', url: '/a', date: '1', readTime: '1', summary: 'sa' },
        { title: 'B', url: '/b', date: '2', readTime: '2', summary: 'sb' },
        { title: 'C', url: '/c', date: '3', readTime: '3', summary: 'sc' },
        { title: 'D', url: '/d', date: '4', readTime: '4', summary: 'sd' },
      ])
    );

    await app.renderLatestArticles(document, fetchMock);

    expect(document.querySelectorAll('.article-card')).toHaveLength(3);
    expect(document.body.innerHTML).toContain('/a');
    expect(document.querySelector('a[href="/d"]')).toBeNull();
  });

  it('renderLatestArticles handles empty and failed responses', async () => {
    document.body.innerHTML = '<div id="latest-articles"></div>';
    await app.renderLatestArticles(document, vi.fn(async () => jsonResponse([])));
    expect(document.body.textContent).toContain('No articles published yet');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await app.renderLatestArticles(document, vi.fn(async () => jsonResponse({}, false, 500)));
    expect(document.body.textContent).toContain('Articles are unavailable');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('initCloudflareAnalytics appends script only when token is provided', () => {
    app.initCloudflareAnalytics(document);
    expect(document.querySelector('script[src*="cloudflareinsights"]')).toBeNull();

    const meta = document.createElement('meta');
    meta.setAttribute('name', 'meb-cf-analytics-token');
    meta.setAttribute('content', '  tok123  ');
    document.head.appendChild(meta);

    app.initCloudflareAnalytics(document);

    const script = document.querySelector('script[src*="cloudflareinsights"]');
    expect(script).not.toBeNull();
    expect(script.getAttribute('data-cf-beacon')).toContain('tok123');
  });

  it('initWriteSession throws on non-ok responses', async () => {
    await expect(app.initWriteSession(async () => ({ ok: true }))).resolves.toBeUndefined();
    await expect(app.initWriteSession(async () => ({ ok: false }))).rejects.toThrow(
      /session_init_failed/
    );
  });

  it('loadTurnstile injects script and renders widget', () => {
    const container = document.createElement('div');
    const state = { turnstileToken: null };
    const render = vi.fn((_el, cfg) => cfg.callback('abc'));
    const win = { turnstile: { render } };

    app.loadTurnstile('site-key', container, state, document, win);
    const script = document.querySelector('script[data-turnstile-loader]');
    expect(script).not.toBeNull();
    script.dispatchEvent(new Event('load'));
    expect(render).toHaveBeenCalledOnce();
    expect(state.turnstileToken).toBe('abc');
  });

  it('loadTurnstile returns when site key is not provided', () => {
    app.loadTurnstile('', document.createElement('div'), { turnstileToken: null }, document, window);
    expect(document.querySelector('script[data-turnstile-loader]')).toBeNull();
  });

  it('loadTurnstile renders immediately when loader script already exists', () => {
    const existing = document.createElement('script');
    existing.dataset.turnstileLoader = 'true';
    document.head.appendChild(existing);

    const container = document.createElement('div');
    const state = { turnstileToken: null };
    const render = vi.fn();
    app.loadTurnstile('site-key', container, state, document, { turnstile: { render } });
    expect(render).toHaveBeenCalledOnce();
  });

  it('createCommentNode blocks reply submit without turnstile token', async () => {
    const mount = document.createElement('section');
    const feedback = document.createElement('p');
    const state = { turnstileToken: null, feedback };
    const node = app.createCommentNode(
      { id: 1, displayName: 'user', createdAt: 'now', html: '<p>hi</p>', replies: [] },
      'article/test',
      mount,
      state,
      {
        fetch: vi.fn(),
        initWriteSession: vi.fn(),
        loadComments: vi.fn(),
      }
    );

    const form = node.querySelector('.comment-reply-form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(state.feedback.textContent).toContain('Turnstile verification');
  });

  it('createCommentNode submits reply and renders replies', async () => {
    const mount = document.createElement('section');
    const feedback = document.createElement('p');
    const state = { turnstileToken: 'tok', feedback };
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, status: 'held' }));
    const loadComments = vi.fn(async () => {});

    const node = app.createCommentNode(
      {
        id: 1,
        displayName: 'user',
        createdAt: 'now',
        html: '<p>hi</p>',
        replies: [{ displayName: 'r1', createdAt: 'later', html: '<p>reply</p>' }],
      },
      'article/test',
      mount,
      state,
      {
        fetch: fetchMock,
        initWriteSession: vi.fn(async () => {}),
        loadComments,
      }
    );

    node.querySelector('.comment-reply-toggle').click();
    expect(node.querySelector('.comment-reply-form').classList.contains('hidden')).toBe(false);
    expect(node.querySelectorAll('.comment-item-reply')).toHaveLength(1);

    const textarea = node.querySelector('textarea[name="markdown"]');
    textarea.value = 'reply markdown';
    const form = node.querySelector('.comment-reply-form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/comments',
      expect.objectContaining({ method: 'POST' })
    );
    expect(feedback.textContent).toContain('held for moderation');
    expect(loadComments).toHaveBeenCalledOnce();
  });

  it('createCommentNode handles reply API failure', async () => {
    const feedback = document.createElement('p');
    const node = app.createCommentNode(
      { id: 1, displayName: 'user', createdAt: 'now', html: '<p>hi</p>', replies: [] },
      'article/test',
      document.createElement('section'),
      { turnstileToken: 'tok', feedback },
      {
        fetch: vi.fn(async () => jsonResponse({ ok: false, error: 'denied' }, false, 403)),
        initWriteSession: vi.fn(async () => {}),
        loadComments: vi.fn(async () => {}),
      }
    );

    const textarea = node.querySelector('textarea[name="markdown"]');
    textarea.value = 'reply markdown';
    node.querySelector('.comment-reply-form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(feedback.textContent).toContain('Reply failed');
  });

  it('loadComments renders fallback states and loaded comments', async () => {
    const mount = document.createElement('section');
    mount.innerHTML = '<div class="comment-list"></div>';
    const state = {};
    const createNode = vi.fn((comment) => {
      const el = document.createElement('article');
      el.textContent = comment.displayName;
      return el;
    });

    await app.loadComments('p1', mount, state, {
      fetch: vi.fn(async () => jsonResponse({ ok: true, comments: [] })),
      createCommentNode: createNode,
    });
    expect(mount.textContent).toContain('No comments yet');

    await app.loadComments('p1', mount, state, {
      fetch: vi.fn(async () =>
        jsonResponse({
          ok: true,
          comments: [{ id: 1, displayName: 'name', createdAt: 'now', html: '<p>x</p>' }],
        })
      ),
      createCommentNode: createNode,
    });
    expect(createNode).toHaveBeenCalled();

    await app.loadComments('p1', mount, state, {
      fetch: vi.fn(async () => jsonResponse({ ok: false, error: 'boom' }, false, 500)),
      createCommentNode: createNode,
    });
    expect(mount.textContent).toContain('Unable to load comments');
  });

  it('initEngagementFeatures wires reactions and blocks comment when token missing', async () => {
    document.body.dataset.pageId = 'article/x';
    document.body.innerHTML = '<main class="section-shell"></main>';

    const fetchMock = vi.fn(async (url) => {
      if (String(url).startsWith('/api/reactions/me')) {
        return jsonResponse({ ok: true, userReaction: 'like' });
      }
      if (url === '/api/session/init') {
        return jsonResponse({ ok: true });
      }
      if (url === '/api/reactions') {
        return jsonResponse({ ok: true, userReaction: 'dislike' });
      }
      if (String(url).startsWith('/api/comments')) {
        return jsonResponse({ ok: true, comments: [] });
      }
      return jsonResponse({}, false, 404);
    });

    await app.initEngagementFeatures(document, fetchMock);
    const likeBtn = document.querySelector('.reaction-btn[data-reaction="like"]');
    const dislikeBtn = document.querySelector('.reaction-btn[data-reaction="dislike"]');
    expect(likeBtn.getAttribute('aria-pressed')).toBe('true');

    dislikeBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dislikeBtn.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.comment-feedback').textContent).toContain('Reaction saved');

    const form = document.querySelector('.comment-form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(document.querySelector('.comment-feedback').textContent).toContain('Turnstile verification');
  });

  it('initEngagementFeatures no-ops without page id or mount target', async () => {
    document.body.innerHTML = '<main class="section-shell"></main>';
    await app.initEngagementFeatures(document, vi.fn());
    expect(document.querySelector('.engagement-shell')).toBeNull();

    document.body.dataset.pageId = 'article/x';
    document.body.innerHTML = '<main></main>';
    await app.initEngagementFeatures(document, vi.fn());
    expect(document.querySelector('.engagement-shell')).toBeNull();
  });

  it('initEngagementFeatures handles reaction and comment failures', async () => {
    document.body.dataset.pageId = 'article/y';
    document.body.innerHTML = '<meta name="meb-turnstile-site-key" content="site-key"><main class="section-shell"></main>';

    window.turnstile = {
      render: (_container, config) => {
        config.callback('tok-1');
      },
    };

    const fetchMock = vi.fn(async (url) => {
      if (String(url).startsWith('/api/reactions/me')) {
        return jsonResponse({ ok: false }, false, 500);
      }
      if (url === '/api/session/init') {
        return jsonResponse({ ok: false }, false, 500);
      }
      if (url === '/api/reactions') {
        return jsonResponse({ ok: false, error: 'nope' }, false, 500);
      }
      if (String(url).startsWith('/api/comments?pageId=')) {
        return jsonResponse({ ok: true, comments: [] });
      }
      if (url === '/api/comments') {
        return jsonResponse({ ok: false, error: 'comment_nope' }, false, 500);
      }
      return jsonResponse({}, false, 404);
    });

    await app.initEngagementFeatures(document, fetchMock);
    const tsScript = document.querySelector('script[data-turnstile-loader]');
    tsScript.dispatchEvent(new Event('load'));

    const like = document.querySelector('.reaction-btn[data-reaction="like"]');
    like.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('.comment-feedback').textContent).toContain('Reaction failed');

    const textarea = document.querySelector('.comment-form textarea[name="markdown"]');
    textarea.value = 'hello world';
    document
      .querySelector('.comment-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('.comment-feedback').textContent).toContain('Comment failed');
  });

  it('initEngagementFeatures publishes comment when turnstile is ready', async () => {
    document.body.dataset.pageId = 'article/z';
    document.body.innerHTML = '<meta name="meb-turnstile-site-key" content="site-key"><main class="section-shell"></main>';

    window.turnstile = {
      render: (_container, config) => {
        config.callback('tok-2');
      },
    };

    const fetchMock = vi.fn(async (url) => {
      if (String(url).startsWith('/api/reactions/me')) {
        return jsonResponse({ ok: true, userReaction: null });
      }
      if (url === '/api/session/init') {
        return jsonResponse({ ok: true });
      }
      if (String(url).startsWith('/api/comments?pageId=')) {
        return jsonResponse({ ok: true, comments: [] });
      }
      if (url === '/api/comments') {
        return jsonResponse({ ok: true, status: 'published', displayName: 'anon-fox' });
      }
      return jsonResponse({ ok: true, userReaction: 'like' });
    });

    await app.initEngagementFeatures(document, fetchMock);
    document.querySelector('script[data-turnstile-loader]').dispatchEvent(new Event('load'));

    document.querySelector('.comment-form input[name="nameOrPseudonym"]').value = 'me';
    document.querySelector('.comment-form textarea[name="markdown"]').value = 'comment text';
    document
      .querySelector('.comment-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector('.comment-feedback').textContent).toContain('Comment published as anon-fox');
  });

  it('startApp orchestrates main initializers', async () => {
    document.body.dataset.bgImage = '/assets/bg.svg';
    document.body.innerHTML = '<div class="parallax-bg"></div><div id="latest-articles"></div>';
    const win = { scrollY: 0, requestAnimationFrame: (cb) => cb(), addEventListener: vi.fn() };
    const fetchMock = vi.fn(async () => jsonResponse([]));
    await app.startApp(document, win, fetchMock);
    expect(document.querySelector('.parallax-bg').style.backgroundImage).toContain('/assets/bg.svg');
  });
});
