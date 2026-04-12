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

  applySectionBackground();
  initParallax();
  renderLatestArticles();
  initCloudflareAnalytics();
})();
