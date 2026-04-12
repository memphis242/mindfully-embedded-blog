(() => {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function applySectionBackground() {
    const bg = document.querySelector('.parallax-bg');
    const url = document.body.dataset.bgImage;

    if (bg && url) {
      bg.style.setProperty('--section-bg', `url(${url})`);
      bg.style.backgroundImage = `url(${url})`;
    }
  }

  function initParallax() {
    if (prefersReducedMotion) return;

    const bg = document.querySelector('.parallax-bg');
    if (!bg) return;

    let ticking = false;

    const update = () => {
      const y = window.scrollY * 0.14;
      bg.style.transform = `translate3d(0, ${y}px, 0)`;
      ticking = false;
    };

    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          window.requestAnimationFrame(update);
          ticking = true;
        }
      },
      { passive: true }
    );
  }

  async function renderLatestArticles() {
    const mount = document.getElementById('latest-articles');
    if (!mount) return;

    try {
      const response = await fetch('/articles/articles.json');
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

  function initCloudflareAnalytics() {
    const tokenMeta = document.querySelector('meta[name="meb-cf-analytics-token"]');
    const token = tokenMeta ? tokenMeta.content.trim() : '';

    if (!token) return;

    const script = document.createElement('script');
    script.defer = true;
    script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    script.setAttribute('data-cf-beacon', JSON.stringify({ token }));
    document.head.appendChild(script);
  }

  async function initWriteSession() {
    const res = await fetch('/api/session/init', {
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

  function setReactionButtonsState(buttons, selected) {
    buttons.forEach((btn) => {
      const active = btn.dataset.reaction === selected;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function loadTurnstile(siteKey, container, state) {
    if (!siteKey) {
      return;
    }

    const ensureRender = () => {
      if (!window.turnstile) return;
      window.turnstile.render(container, {
        sitekey: siteKey,
        theme: 'dark',
        callback(token) {
          state.token = token;
        },
        'expired-callback'() {
          state.token = null;
        },
        'error-callback'() {
          state.token = null;
        },
      });
    };

    if (!document.querySelector('script[data-turnstile-loader]')) {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.turnstileLoader = 'true';
      script.addEventListener('load', ensureRender);
      document.head.appendChild(script);
      return;
    }

    if (window.turnstile) {
      ensureRender();
    }
  }

  function createCommentNode(comment, pageId, mount, state) {
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
        await initWriteSession();

        const response = await fetch('/api/comments', {
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

        state.feedback.textContent = payload.status === 'held'
          ? 'Reply submitted and held for moderation checks.'
          : 'Reply published.';

        await loadComments(pageId, mount, state);
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

  async function loadComments(pageId, mount, state) {
    const list = mount.querySelector('.comment-list');
    if (!list) return;

    list.innerHTML = '<p class="article-meta">Loading comments...</p>';

    try {
      const response = await fetch(`/api/comments?pageId=${encodeURIComponent(pageId)}`);
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
        list.appendChild(createCommentNode(comment, pageId, mount, state));
      });
    } catch (err) {
      list.innerHTML = `<p class="article-meta">Unable to load comments: ${err.message}</p>`;
    }
  }

  async function initEngagementFeatures() {
    const pageId = document.body.dataset.pageId;
    if (!pageId) return;

    const mountTarget = document.querySelector('.section-shell');
    if (!mountTarget) return;

    const section = document.createElement('section');
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

    const turnstileSiteKey = (document.querySelector('meta[name="meb-turnstile-site-key"]')?.content || '').trim();
    const turnstileWrap = section.querySelector('.turnstile-wrap');

    if (turnstileSiteKey) {
      loadTurnstile(turnstileSiteKey, turnstileWrap, state);
    } else {
      turnstileWrap.innerHTML = '<p class="article-meta">Commenting is disabled until Turnstile site key is configured.</p>';
    }

    const reactionButtons = [...section.querySelectorAll('.reaction-btn')];

    try {
      const response = await fetch(`/api/reactions/me?pageId=${encodeURIComponent(pageId)}`);
      const payload = await response.json();
      if (payload?.ok) {
        setReactionButtonsState(reactionButtons, payload.userReaction);
      }
    } catch {
      // Ignore non-critical hydration errors.
    }

    for (const btn of reactionButtons) {
      btn.addEventListener('click', async () => {
        try {
          await initWriteSession();

          const response = await fetch('/api/reactions', {
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
        await initWriteSession();

        const response = await fetch('/api/comments', {
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

        state.feedback.textContent = payload.status === 'held'
          ? `Comment submitted as ${payload.displayName} and held for moderation checks.`
          : `Comment published as ${payload.displayName}.`;

        await loadComments(pageId, section, state);
      } catch (err) {
        state.feedback.textContent = `Comment failed: ${err.message}`;
      }
    });

    await loadComments(pageId, section, state);
  }

  applySectionBackground();
  initParallax();
  renderLatestArticles();
  initCloudflareAnalytics();
  initEngagementFeatures();
})();
