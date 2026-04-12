import { setReactionButtonsState } from './engagement-helpers.js';

export function applySectionBackground(doc = document) {
  const bg = doc.querySelector('.parallax-bg');
  const url = doc.body?.dataset?.bgImage;

  if (bg && url) {
    bg.style.setProperty('--section-bg', `url(${url})`);
    bg.style.backgroundImage = `url(${url})`;
  }
}

export function initParallax(win = window, doc = document, prefersReducedMotion = null) {
  const reduced =
    prefersReducedMotion ?? win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  if (reduced) return;

  const bg = doc.querySelector('.parallax-bg');
  if (!bg) return;

  let ticking = false;

  const update = () => {
    const y = win.scrollY * 0.14;
    bg.style.transform = `translate3d(0, ${y}px, 0)`;
    ticking = false;
  };

  win.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        win.requestAnimationFrame(update);
        ticking = true;
      }
    },
    { passive: true }
  );
}

export async function renderLatestArticles(doc = document, fetchImpl = fetch) {
  const mount = doc.getElementById('latest-articles');
  if (!mount) return;

  try {
    const response = await fetchImpl('/articles/articles.json');
    if (!response.ok) throw new Error(`status ${response.status}`);

    const articles = await response.json();
    const latest = articles.slice(0, 3);

    if (latest.length === 0) {
      mount.innerHTML = '<p class="panel">No articles published yet.</p>';
      return;
    }

    mount.innerHTML = latest
      .map(
        (article) => `
            <article class="article-card">
              <h2><a href="${article.url}" class="inline-link">${article.title}</a></h2>
              <p class="article-meta">${article.date} · ${article.readTime}</p>
              <p>${article.summary}</p>
            </article>
          `
      )
      .join('');
  } catch (err) {
    mount.innerHTML = '<p class="panel">Articles are unavailable until the build step runs.</p>';
    console.error('Failed to load article list:', err);
  }
}

export function initCloudflareAnalytics(doc = document) {
  const tokenMeta = doc.querySelector('meta[name="meb-cf-analytics-token"]');
  const token = tokenMeta ? tokenMeta.content.trim() : '';

  if (!token) return;

  const script = doc.createElement('script');
  script.defer = true;
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  script.setAttribute('data-cf-beacon', JSON.stringify({ token }));
  doc.head.appendChild(script);
}

export async function initWriteSession(fetchImpl = fetch) {
  const res = await fetchImpl('/api/session/init', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  if (!res.ok) {
    throw new Error('session_init_failed');
  }
}

export function loadTurnstile(siteKey, container, state, doc = document, win = window) {
  if (!siteKey) {
    return;
  }

  const ensureRender = () => {
    if (!win.turnstile) return;
    win.turnstile.render(container, {
      sitekey: siteKey,
      theme: 'dark',
      callback(token) {
        state.turnstileToken = token;
      },
      'expired-callback'() {
        state.turnstileToken = null;
      },
      'error-callback'() {
        state.turnstileToken = null;
      },
    });
  };

  if (!doc.querySelector('script[data-turnstile-loader]')) {
    const script = doc.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.turnstileLoader = 'true';
    script.addEventListener('load', ensureRender);
    doc.head.appendChild(script);
    return;
  }

  if (win.turnstile) {
    ensureRender();
  }
}

export function createCommentNode(comment, pageId, mount, state, deps) {
  const wrapper = document.createElement('article');
  wrapper.className = 'comment-item';

  const header = document.createElement('div');
  header.className = 'comment-header';
  header.innerHTML = `<strong>${comment.displayName}</strong><span>${comment.createdAt}</span>`;

  const body = document.createElement('div');
  body.className = 'comment-body';
  body.innerHTML = comment.html;

  const replyToggle = document.createElement('button');
  replyToggle.className = 'btn subtle comment-reply-toggle';
  replyToggle.type = 'button';
  replyToggle.textContent = 'Reply';

  const replyForm = document.createElement('form');
  replyForm.className = 'comment-reply-form hidden';
  replyForm.innerHTML = `
      <label>
        Name or pseudonym (optional)
        <input type="text" name="nameOrPseudonym" maxlength="40" placeholder="e.g. calm-debugger" />
      </label>
      <label>
        Reply
        <textarea name="markdown" rows="3" maxlength="2000" required></textarea>
      </label>
      <button class="btn" type="submit">Post reply</button>
    `;

  replyToggle.addEventListener('click', () => {
    replyForm.classList.toggle('hidden');
  });

  replyForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!state.turnstileToken) {
      state.feedback.textContent = 'Commenting is blocked until Turnstile verification is complete.';
      return;
    }

    const formData = new FormData(replyForm);

    try {
      await deps.initWriteSession(deps.fetch);

      const response = await deps.fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId,
          parentId: comment.id,
          nameOrPseudonym: String(formData.get('nameOrPseudonym') || ''),
          markdown: String(formData.get('markdown') || ''),
          turnstileToken: state.turnstileToken,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'reply_failed');
      }

      state.feedback.textContent =
        payload.status === 'held'
          ? 'Reply submitted and held for moderation checks.'
          : 'Reply published.';

      await deps.loadComments(pageId, mount, state, deps);
    } catch (err) {
      state.feedback.textContent = `Reply failed: ${err.message}`;
    }
  });

  wrapper.appendChild(header);
  wrapper.appendChild(body);
  wrapper.appendChild(replyToggle);
  wrapper.appendChild(replyForm);

  if (comment.replies && comment.replies.length) {
    const replies = document.createElement('div');
    replies.className = 'comment-replies';
    comment.replies.forEach((reply) => {
      const child = document.createElement('article');
      child.className = 'comment-item comment-item-reply';
      child.innerHTML = `
          <div class="comment-header"><strong>${reply.displayName}</strong><span>${reply.createdAt}</span></div>
          <div class="comment-body">${reply.html}</div>
        `;
      replies.appendChild(child);
    });
    wrapper.appendChild(replies);
  }

  return wrapper;
}

export async function loadComments(pageId, mount, state, deps = { fetch, createCommentNode }) {
  const list = mount.querySelector('.comment-list');
  if (!list) return;

  list.innerHTML = '<p class="article-meta">Loading comments...</p>';

  try {
    const response = await deps.fetch(`/api/comments?pageId=${encodeURIComponent(pageId)}`);
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'comments_load_failed');
    }

    const comments = payload.comments || [];
    if (!comments.length) {
      list.innerHTML = '<p class="article-meta">No comments yet.</p>';
      return;
    }

    list.innerHTML = '';
    comments.forEach((comment) => {
      list.appendChild(deps.createCommentNode(comment, pageId, mount, state, deps));
    });
  } catch (err) {
    list.innerHTML = `<p class="article-meta">Unable to load comments: ${err.message}</p>`;
  }
}

export async function initEngagementFeatures(doc = document, fetchImpl = fetch) {
  const pageId = doc.body.dataset.pageId;
  if (!pageId) return;

  const mountTarget = doc.querySelector('.section-shell');
  if (!mountTarget) return;

  const section = doc.createElement('section');
  section.className = 'engagement-shell';
  section.innerHTML = `
      <h2>Feedback</h2>
      <p class="article-meta">Tell me if this page was useful, and leave a comment.</p>
      <div class="reaction-row" role="group" aria-label="Page reaction">
        <button class="btn subtle reaction-btn" data-reaction="like" aria-pressed="false" type="button">Like</button>
        <button class="btn subtle reaction-btn" data-reaction="dislike" aria-pressed="false" type="button">Dislike</button>
      </div>
      <h3>Comments</h3>
      <form class="comment-form">
        <label>
          Name or pseudonym (optional)
          <input type="text" name="nameOrPseudonym" maxlength="40" placeholder="Leave blank for a fun auto-name" />
        </label>
        <label>
          Comment
          <textarea name="markdown" rows="4" maxlength="2000" required></textarea>
        </label>
        <div class="turnstile-wrap"></div>
        <button class="btn" type="submit">Post comment</button>
      </form>
      <p class="comment-feedback article-meta" aria-live="polite"></p>
      <div class="comment-list"></div>
    `;

  mountTarget.appendChild(section);

  const state = {
    turnstileToken: null,
    feedback: section.querySelector('.comment-feedback'),
  };

  const turnstileSiteKey = (doc.querySelector('meta[name="meb-turnstile-site-key"]')?.content || '').trim();
  const turnstileWrap = section.querySelector('.turnstile-wrap');

  if (turnstileSiteKey) {
    loadTurnstile(turnstileSiteKey, turnstileWrap, state, doc, window);
  } else {
    turnstileWrap.innerHTML =
      '<p class="article-meta">Commenting is disabled until Turnstile site key is configured.</p>';
  }

  const reactionButtons = [...section.querySelectorAll('.reaction-btn')];

  try {
    const response = await fetchImpl(`/api/reactions/me?pageId=${encodeURIComponent(pageId)}`);
    const payload = await response.json();
    if (payload?.ok) {
      setReactionButtonsState(reactionButtons, payload.userReaction);
    }
  } catch {
    // non critical
  }

  for (const btn of reactionButtons) {
    btn.addEventListener('click', async () => {
      try {
        await initWriteSession(fetchImpl);

        const response = await fetchImpl('/api/reactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageId,
            reaction: btn.dataset.reaction,
          }),
        });

        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || 'reaction_failed');
        }

        setReactionButtonsState(reactionButtons, payload.userReaction);
        state.feedback.textContent = 'Reaction saved.';
      } catch (err) {
        state.feedback.textContent = `Reaction failed: ${err.message}`;
      }
    });
  }

  const form = section.querySelector('.comment-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!state.turnstileToken) {
      state.feedback.textContent = 'Commenting is blocked until Turnstile verification is complete.';
      return;
    }

    const formData = new FormData(form);
    const markdown = String(formData.get('markdown') || '');

    try {
      await initWriteSession(fetchImpl);

      const response = await fetchImpl('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId,
          nameOrPseudonym: String(formData.get('nameOrPseudonym') || ''),
          markdown,
          turnstileToken: state.turnstileToken,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'comment_failed');
      }

      form.reset();

      state.feedback.textContent =
        payload.status === 'held'
          ? `Comment submitted as ${payload.displayName} and held for moderation checks.`
          : `Comment published as ${payload.displayName}.`;

      await loadComments(pageId, section, state, {
        fetch: fetchImpl,
        createCommentNode,
      });
    } catch (err) {
      state.feedback.textContent = `Comment failed: ${err.message}`;
    }
  });

  await loadComments(pageId, section, state, {
    fetch: fetchImpl,
    createCommentNode,
  });
}

export async function startApp(doc = document, win = window, fetchImpl = fetch) {
  applySectionBackground(doc);
  initParallax(win, doc);
  await renderLatestArticles(doc, fetchImpl);
  initCloudflareAnalytics(doc);
  await initEngagementFeatures(doc, fetchImpl);
}
