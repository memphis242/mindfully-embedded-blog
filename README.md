# MindfullyEmbedded

MindfullyEmbedded is my personal tech blog, where I include articles, a project portfolio, professional bio, client success stories, training, consulting, and independent contract work information. I kept the frameworks at a minimum and the tech stack is HTML/CSS/(vanilla)JS with Cloudflare hosting and uses of available Cloudflare tool APIs (e.g., Turnstile, Pages, etc.).

## Features

- Article-first homepage and generated article pages
- Bio page with inline PDF resume viewer + download CTA
- Portfolio shelf with project detail pages and top-centered hero media
- Success stories page with anonymized measurable outcomes
- Client services pages (training, consulting, project contracts) with secure quote-request forms
- Section-specific parallax backgrounds
- Anonymous likes/dislikes on article and project pages
- Anonymous comments with one-level replies, optional pseudonym, and safe auto-generated fallback names
- Admin moderation dashboard with ban controls and audit-friendly APIs

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build static pages:
   ```bash
   npm run build
   ```
3. Run local static server:
   ```bash
   npm start
   ```
4. Open:
   ```
   http://localhost:3000
   ```

Note: `node server.js` serves static files only. Cloudflare Functions APIs run when deployed (or via `wrangler pages dev`).

## Article Authoring

1. Add publishable Markdown under `content/articles/`.
2. Keep drafts in `content/drafts/` (ignored by current build flow).
3. Required frontmatter keys:
   - `title`
   - `slug`
   - `date`
   - `summary`
   - `tags`
   - `readTime`
   - `published`
4. Run `npm run build`.

Generated files:

- `public/articles/generated/*.html`
- `public/articles/articles.json`
- `public/articles/index.html`

## Shared Footer Template

- Source of truth: `templates/footer.html`
- Build-time injector: `scripts/apply-templates.js`

## Cloudflare Setup

### 1) Create D1 + apply schema

```bash
wrangler d1 create mindfully-embedded-blog-db
wrangler d1 execute mindfully-embedded-blog-db --file=db/schema.sql
```

### 2) Create KV namespace

```bash
wrangler kv namespace create RATE_LIMITS
```

### 3) Configure `wrangler.toml`

- Replace placeholder D1 database ID
- Replace KV namespace ID
- Set `ALLOWED_ORIGINS`
- Optionally set `ADMIN_IP_ALLOWLIST`

You can copy `.dev.vars.example` to `.dev.vars` for local `wrangler pages dev` secrets.

### 4) Configure secrets

```bash
wrangler secret put APP_SIGNING_SECRET
wrangler secret put IP_HASH_SALT
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put ADMIN_SERVICE_TOKEN
```

### 5) Frontend Turnstile site key

Set meta tag content on pages using engagement widget:

```html
<meta name="meb-turnstile-site-key" content="YOUR_TURNSTILE_SITE_KEY" />
```

### 6) Build/deploy

- Build command: `npm run build`
- Output directory: `public`

## Security Posture (Implemented)

- Signed write-session cookie: `HttpOnly`, `Secure`, `SameSite=Strict`, 24h TTL
- Session binding to IP-hash + UA-hash
- Strict origin allowlist for write endpoints
- Turnstile required for comment/reply submission
- Rate limiting via KV + ban checks via D1
- Ban model: IP-hash and subnet-hash support
- Admin APIs gated by Cloudflare Access identity + service token + optional IP allowlist

## Code Quality Tooling

- Formatter: Prettier
- Linters: ESLint (JS), Stylelint (CSS), HTMLHint (HTML)
- Unit tests: Vitest + jsdom
- Local hooks: Husky + lint-staged
- CI: GitHub Actions quality and security workflows

Useful commands:

```bash
npm run format:check
npm run lint
npm run test
npm run quality
```

Security scanning commands:

```bash
npm run security:deps
npm run security:sast
npm run security:secrets
```

## Admin Endpoints

- `GET /api/admin/comments`
- `POST /api/admin/comments/:id` with `{ action: "visible"|"hidden"|"deleted", reason? }`
- `GET /api/admin/bans`
- `POST /api/admin/bans`
- `DELETE /api/admin/bans?id=...`
- `GET /api/admin/digest`
- `POST /api/admin/maintenance`
- `GET /api/admin/leads`
- `POST /api/admin/leads/:id`

Admin UI:

- `/admin/moderation/`
- `/admin/leads/`

## Design Reference

- `docs/visual-personality-plan.md`
