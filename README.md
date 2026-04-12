# MindfullyEmbedded

MindfullyEmbedded is a dark-mode personal technical site built with plain HTML/CSS/JS, plus a minimal Node build script for Markdown articles.

## Features
- Article-first homepage and generated article pages
- Bio page with inline PDF resume viewer + download CTA
- Portfolio shelf with project detail pages and top-centered hero media
- Success stories page with anonymized measurable outcomes
- Section-specific parallax background motifs

## Local Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Build article pages from Markdown:
   ```bash
   npm run build
   ```
3. Run local server:
   ```bash
   npm start
   ```
4. Open:
   ```
   http://localhost:3000
   ```

## Writing New Articles
1. Add a Markdown file under `content/articles/`.
2. Include required frontmatter keys:
   - `title`
   - `slug`
   - `date`
   - `summary`
   - `tags`
   - `readTime`
   - `published`
3. Run `npm run build`.

Generated files are written to:
- `public/articles/generated/*.html`
- `public/articles/articles.json`
- `public/articles/index.html`

## Shared Footer Template
- Footer source of truth: `templates/footer.html`
- Build-time template injector: `scripts/apply-templates.js`
- Pages use `<!-- @site-footer -->` during generation and are populated during `npm run build`.

## Cloudflare Pages Deployment
- Build command: `npm run build`
- Build output directory: `public`
- Optional privacy-first analytics token can be set by filling the page meta value `meb-cf-analytics-token`.

## Design Reference
Canonical visual system specification:
- `docs/visual-personality-plan.md`
