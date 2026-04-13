#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

const ROOT = process.env.MEB_ROOT || path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content', 'articles');
const OUTPUT_DIR = path.join(ROOT, 'public', 'articles', 'generated');
const ARTICLES_JSON = path.join(ROOT, 'public', 'articles', 'articles.json');
const ARTICLES_INDEX = path.join(ROOT, 'public', 'articles', 'index.html');

marked.setOptions({
  gfm: true,
  breaks: false,
});

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function removeDirContents(dir) {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, file), { recursive: true, force: true });
  }
}

function escapeHtml(input) {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function assertFrontmatter(meta, fileName) {
  const required = ['title', 'slug', 'date', 'summary', 'tags', 'readTime', 'published'];
  const missing = required.filter((field) => meta[field] === undefined || meta[field] === null);

  if (missing.length > 0) {
    throw new Error(`${fileName}: missing required frontmatter: ${missing.join(', ')}`);
  }

  if (!Array.isArray(meta.tags)) {
    throw new Error(`${fileName}: 'tags' must be an array`);
  }

  if (typeof meta.published !== 'boolean') {
    throw new Error(`${fileName}: 'published' must be a boolean`);
  }

  const date = new Date(meta.date);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fileName}: invalid 'date' format`);
  }

  return {
    title: String(meta.title),
    slug: String(meta.slug),
    date: date.toISOString().slice(0, 10),
    summary: String(meta.summary),
    tags: meta.tags.map((tag) => String(tag)),
    readTime: String(meta.readTime),
    published: meta.published,
  };
}

function articlePageTemplate(article, htmlBody) {
  const tags = article.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(article.title)} | MindfullyEmbedded</title>
  <meta name="description" content="${escapeHtml(article.summary)}" />
  <meta name="meb-turnstile-site-key" content="" />
  <link rel="stylesheet" href="/css/global.css" />
</head>
<body class="page article-detail" data-section="articles" data-bg-image="/assets/backgrounds/articles-bg.svg" data-page-id="article/${escapeHtml(article.slug)}">
  <div class="parallax-bg" aria-hidden="true"></div>
  <header class="site-header">
    <a class="brand" href="/">MindfullyEmbedded</a>
    <nav class="site-nav" aria-label="Primary">
      <a href="/articles/" class="active">Articles</a>
      <a href="/portfolio/">Portfolio</a>
      <a href="/services/training/">Training</a>
      <a href="/services/consulting/">Consulting</a>
      <a href="/services/contracts/">Contracts</a>
      <a href="/professional/">Bio</a>
      <a href="/success-stories/">Success Stories</a>
    </nav>
  </header>

  <main class="container section-shell article-shell">
    <p class="eyebrow">Technical Article</p>
    <h1>${escapeHtml(article.title)}</h1>
    <p class="article-meta">${escapeHtml(article.date)} · ${escapeHtml(article.readTime)}</p>
    <p class="lede">${escapeHtml(article.summary)}</p>
    <div class="tag-row">${tags}</div>
    <article class="prose">${htmlBody}</article>
  </main>

  <!-- @site-footer -->
  <script type="module" src="/js/main.js"></script>
</body>
</html>`;
}

function articleIndexTemplate(cards) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Articles | MindfullyEmbedded</title>
  <meta name="description" content="Technical articles on embedded systems and engineering lessons." />
  <link rel="stylesheet" href="/css/global.css" />
</head>
<body class="page" data-section="articles" data-bg-image="/assets/backgrounds/articles-bg.svg">
  <div class="parallax-bg" aria-hidden="true"></div>
  <header class="site-header">
    <a class="brand" href="/">MindfullyEmbedded</a>
    <nav class="site-nav" aria-label="Primary">
      <a href="/articles/" class="active">Articles</a>
      <a href="/portfolio/">Portfolio</a>
      <a href="/services/training/">Training</a>
      <a href="/services/consulting/">Consulting</a>
      <a href="/services/contracts/">Contracts</a>
      <a href="/professional/">Bio</a>
      <a href="/success-stories/">Success Stories</a>
    </nav>
  </header>

  <main class="container section-shell">
    <p class="eyebrow">Embedded Systems + Engineering Lessons</p>
    <h1>Articles</h1>
    <p class="lede">Practical notes from building systems, debugging in the real world, and making design tradeoffs with intent.</p>

    <section class="article-grid" aria-label="Published articles">
      ${cards || '<p>No published articles yet.</p>'}
    </section>
  </main>

  <!-- @site-footer -->
  <script type="module" src="/js/main.js"></script>
</body>
</html>`;
}

function cardMarkup(article) {
  const tags = article.tags
    .slice(0, 3)
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join('');
  return `<article class="article-card">
  <h2><a href="/articles/generated/${encodeURIComponent(article.slug)}.html">${escapeHtml(article.title)}</a></h2>
  <p class="article-meta">${escapeHtml(article.date)} · ${escapeHtml(article.readTime)}</p>
  <p>${escapeHtml(article.summary)}</p>
  <div class="tag-row">${tags}</div>
</article>`;
}

function collectArticles() {
  ensureDir(CONTENT_DIR);

  const sourceFiles = fs
    .readdirSync(CONTENT_DIR)
    .filter((file) => file.endsWith('.md'))
    .map((file) => path.join(CONTENT_DIR, file));

  const articles = [];

  for (const fullPath of sourceFiles) {
    const fileName = path.basename(fullPath);
    const raw = fs.readFileSync(fullPath, 'utf8');
    const parsed = matter(raw);
    const meta = assertFrontmatter(parsed.data, fileName);

    const htmlBody = marked.parse(parsed.content);

    articles.push({
      ...meta,
      htmlBody,
      sourceFile: fileName,
      url: `/articles/generated/${meta.slug}.html`,
    });
  }

  return articles.filter((a) => a.published).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function writeOutputs(articles) {
  ensureDir(OUTPUT_DIR);
  removeDirContents(OUTPUT_DIR);

  for (const article of articles) {
    const fullHtml = articlePageTemplate(article, article.htmlBody);
    fs.writeFileSync(path.join(OUTPUT_DIR, `${article.slug}.html`), fullHtml, 'utf8');
  }

  const serializable = articles.map((article) => ({
    title: article.title,
    slug: article.slug,
    date: article.date,
    summary: article.summary,
    tags: article.tags,
    readTime: article.readTime,
    published: article.published,
    url: article.url,
  }));
  fs.writeFileSync(ARTICLES_JSON, JSON.stringify(serializable, null, 2), 'utf8');

  const cards = articles.map(cardMarkup).join('\n');
  fs.writeFileSync(ARTICLES_INDEX, articleIndexTemplate(cards), 'utf8');
}

function run() {
  const articles = collectArticles();
  writeOutputs(articles);
  console.log(`Built ${articles.length} published article(s).`);
}

/* c8 ignore start */
if (require.main === module) {
  try {
    run();
  } catch (err) {
    console.error(`Article builder script failed: ${err.message}`);
    process.exitCode = 1;
  }
}
/* c8 ignore stop */

module.exports = {
  ensureDir,
  removeDirContents,
  escapeHtml,
  assertFrontmatter,
  articlePageTemplate,
  articleIndexTemplate,
  cardMarkup,
  collectArticles,
  writeOutputs,
  run,
};
