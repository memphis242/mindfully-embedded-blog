# TEST PLAN: Reactions, Comments, and Security

## Summary

This plan validates the engagement + security system for MindfullyEmbedded:

- Likes/dislikes on article and project pages
- Comments + one-level replies
- Optional pseudonym with safe auto-generated fallback names
- Admin moderation and ban workflows
- Security controls (session auth, origin restrictions, Turnstile, rate limiting, bans)

This is a release-gated plan with explicit how-to steps for:

- Local testing
- Remote staging testing (production-like)

## Who This Is For

This document is written for someone new to web testing. If you can run terminal commands and open browser DevTools, you can execute this plan.

## Ownership and Cadence

- Primary owner: site maintainer
- RC cadence: run hard-gate suites before every production release
- Incident drills: monthly in staging
- Evidence: timestamped checklist + notes + sanitized request/response snippets

## Release Gates

### Hard gates (must pass)

- `S-*` Security/Auth
- Write-path integrity from `F-*`
- `A-*` abuse control enforcement
- Admin auth boundaries from `M-*`

### Soft gates (can ship with documented exception)

- Cosmetic defects
- Minor non-security copy/layout issues

## Environments

### Local

- Runtime: `wrangler pages dev public --d1 DB --kv RATE_LIMITS`
- Purpose: fast iteration and deterministic checks

### Remote Staging (production-like)

- Deploy same commit as release candidate
- Same Cloudflare product stack: Pages Functions + D1 + KV + Turnstile + Access
- Same secret structure and security headers
- Purpose: verify real edge/network behavior before production

## Browser Matrix (required)

- Desktop Chrome
- Desktop Firefox
- Desktop Safari
- iOS Safari
- Android Chrome

---

## 1) Prerequisites and One-Time Setup

### 1.1 Tools

Install and verify:

```bash
node -v
npm -v
wrangler -v
```

### 1.2 Local config files

1. Copy env template:

```bash
cp .dev.vars.example .dev.vars
```

2. Fill values in `.dev.vars`:

- `APP_SIGNING_SECRET`
- `IP_HASH_SALT`
- `TURNSTILE_SECRET_KEY`
- `ADMIN_SERVICE_TOKEN`
- `ALLOWED_ORIGINS=http://127.0.0.1:8788,http://localhost:8788`

### 1.3 Local D1 schema

```bash
wrangler d1 execute mindfully-embedded-blog-db --local --file=db/schema.sql
```

### 1.4 Build static pages

```bash
npm run build
```

### 1.5 Start local runtime

```bash
wrangler pages dev public --d1 DB --kv RATE_LIMITS
```

Default URL: `http://127.0.0.1:8788`

### 1.6 Staging setup (production-like)

- Deploy same branch/commit as RC
- Confirm staging has:
  - D1 schema applied
  - KV namespace bound
  - All secrets set
  - Turnstile site key in page meta
  - Access policy active for admin routes

---

## 2) Test Execution Conventions

### 2.1 Host variables

Use these in commands:

```bash
export LOCAL_BASE="http://127.0.0.1:8788"
export STAGE_BASE="https://staging.example.com"
```

### 2.2 Cookie jar files

Use cookie jars to preserve session state:

```bash
export CJ_LOCAL="/tmp/meb-local.cookies"
export CJ_STAGE="/tmp/meb-stage.cookies"
rm -f "$CJ_LOCAL" "$CJ_STAGE"
```

### 2.3 Test page IDs

Example page IDs:

- `article/engineering-calm-in-fault-analysis`
- `project/fault-observatory`

### 2.4 Evidence capture (per test)

Record:

- Test ID
- Environment (`local` or `staging`)
- Timestamp
- Command used or browser steps
- Result (`pass`/`fail`)
- Error payload/screenshot (sanitized)

---

## 3) Detailed Test Cases (How-To)

Each test has:

- **Goal**
- **Local steps**
- **Staging steps**
- **Expected result**

## Functional (`F-*`)

### F-01 Reaction create/update

Goal: one reaction per page/session, switchable.

Local steps:

1. Initialize session:

```bash
curl -i -c "$CJ_LOCAL" -X POST "$LOCAL_BASE/api/session/init" \
  -H "Origin: $LOCAL_BASE" -H "Content-Type: application/json" -d '{}'
```

2. Send `like`:

```bash
curl -i -b "$CJ_LOCAL" -X POST "$LOCAL_BASE/api/reactions" \
  -H "Origin: $LOCAL_BASE" -H "Content-Type: application/json" \
  -d '{"pageId":"article/engineering-calm-in-fault-analysis","reaction":"like"}'
```

3. Send `dislike` for same page/session.

Staging steps:

- Repeat same commands with `STAGE_BASE` and `CJ_STAGE`.

Expected:

- API returns `ok: true` both times.
- Final state from `/api/reactions/me?pageId=...` is `dislike`.

### F-02 Comment with provided pseudonym

Goal: valid pseudonym accepted.

Local steps:

1. In browser, open article page.
2. Ensure Turnstile is solved.
3. Submit comment with name `calm-debugger`.

Staging steps:

- Repeat on staging article page.

Expected:

- Comment accepted (visible or held by moderation logic).
- Display name equals normalized provided name.

### F-03 Comment with blank pseudonym

Goal: auto-generate safe two-word name.

Local steps:

1. Submit comment with empty name field.
2. Observe API/UI response message.

Staging steps:

- Repeat.

Expected:

- Response includes generated safe name like `curious-circuit`.
- If collision occurs, suffix form like `curious-circuit-27`.

### F-04 Reply to top-level comment

Goal: depth-1 replies are allowed.

Local steps:

1. Create top-level comment.
2. Click `Reply` under it.
3. Submit reply.

Staging steps:

- Repeat.

Expected:

- Reply accepted.
- Reply appears nested under parent.

### F-05 Reply to reply rejected

Goal: depth > 1 blocked.

Local steps:

1. Capture first-level reply ID from comments API output.
2. Try POST `/api/comments` with `parentId` set to reply ID.

Staging steps:

- Repeat.

Expected:

- Request rejected with depth error (`reply_depth_exceeded`).

### F-06 Comment retrieval shape

Goal: API returns top-level + one-level replies.

Local steps:

```bash
curl -s "$LOCAL_BASE/api/comments?pageId=article/engineering-calm-in-fault-analysis" | jq .
```

Staging steps:

- Same with `STAGE_BASE`.

Expected:

- Top-level entries include `replies` arrays.
- Reply entries do not contain nested replies.

## Security/Auth (`S-*`)

### S-01 Missing Origin rejected

Local:

```bash
curl -i -X POST "$LOCAL_BASE/api/session/init" -H "Content-Type: application/json" -d '{}'
```

Staging: same.
Expected: reject with origin-related error.

### S-02 Disallowed Origin rejected

Local:

```bash
curl -i -X POST "$LOCAL_BASE/api/session/init" \
  -H "Origin: https://evil.example" -H "Content-Type: application/json" -d '{}'
```

Staging: same.
Expected: reject.

### S-03 Missing/invalid session cookie rejected on writes

Local:

```bash
curl -i -X POST "$LOCAL_BASE/api/reactions" \
  -H "Origin: $LOCAL_BASE" -H "Content-Type: application/json" \
  -d '{"pageId":"article/engineering-calm-in-fault-analysis","reaction":"like"}'
```

Staging: same.
Expected: reject `invalid_session`.

### S-04 Session replay with binding mismatch

Local:

1. Get valid session cookie with one `User-Agent`.
2. Reuse same cookie with different `User-Agent` header on write.

Command example:

```bash
curl -i -b "$CJ_LOCAL" -X POST "$LOCAL_BASE/api/reactions" \
  -H "Origin: $LOCAL_BASE" -H "User-Agent: different-agent" \
  -H "Content-Type: application/json" \
  -d '{"pageId":"article/engineering-calm-in-fault-analysis","reaction":"like"}'
```

Staging: same.
Expected: reject binding mismatch.

### S-05 Missing Turnstile token on comment/reply

Local:

```bash
curl -i -b "$CJ_LOCAL" -X POST "$LOCAL_BASE/api/comments" \
  -H "Origin: $LOCAL_BASE" -H "Content-Type: application/json" \
  -d '{"pageId":"article/engineering-calm-in-fault-analysis","markdown":"hello","nameOrPseudonym":"tester"}'
```

Staging: same.
Expected: reject missing token.

### S-06 Invalid Turnstile token

Same as S-05 but pass `turnstileToken:"invalid"`.
Expected: reject.

### S-07 Admin endpoint missing Access identity

Local/Staging:

```bash
curl -i "$LOCAL_BASE/api/admin/comments" -H "x-admin-service-token: YOUR_TOKEN"
```

Expected: reject.

### S-08 Admin endpoint bad service token

Local/Staging:

```bash
curl -i "$LOCAL_BASE/api/admin/comments" \
  -H "CF-Access-Authenticated-User-Email: you@example.com" \
  -H "x-admin-service-token: wrong"
```

Expected: reject.

### S-09 Admin endpoint non-allowlisted IP (when enabled)

Local/Staging:

- Enable allowlist excluding your current IP.
- Call admin endpoint with valid Access email + token.
  Expected: reject.

## Abuse Controls (`A-*`)

### A-01 Comment burst limit

Goal: exceed burst threshold quickly.

Local steps:

- Use a loop to post >3 comments within 10 minutes.

Example:

```bash
for i in 1 2 3 4; do
  curl -s -o /dev/null -w "%{http_code}\n" -b "$CJ_LOCAL" -X POST "$LOCAL_BASE/api/comments" \
    -H "Origin: $LOCAL_BASE" -H "Content-Type: application/json" \
    -d '{"pageId":"article/engineering-calm-in-fault-analysis","nameOrPseudonym":"burst-tester","markdown":"burst test","turnstileToken":"REPLACE_VALID_TOKEN"}'
done
```

Staging: repeat with staging base.
Expected: one of later requests returns 429.

### A-02 Comment daily limit

- Continue posting until daily threshold exceeded.
  Expected: 429 at threshold+1.

### A-03 Reply daily limit

- Post replies to a top-level comment until threshold exceeded.
  Expected: 429.

### A-04 Reaction daily limit

- Toggle reactions across pages until threshold exceeded.
  Expected: 429.

### A-05 IP-hash ban enforcement

Local/staging:

1. Use admin API to create IP-hash ban.
2. Retry comment/reaction write from same client.
   Expected: blocked with ban error.

### A-06 Subnet ban enforcement

Local/staging:

1. Create subnet ban via admin ban API.
2. Retry writes from matching subnet source.
   Expected: blocked.

### A-07 First-pass moderation hold

Local/staging:

1. Submit comment with >3 links or spammy repeated characters.
   Expected: stored as `held`, not visible in public list.

## Moderation/Admin (`M-*`)

### M-01 List comments

Local/staging:

```bash
curl -s "$LOCAL_BASE/api/admin/comments" \
  -H "CF-Access-Authenticated-User-Email: you@example.com" \
  -H "x-admin-service-token: YOUR_TOKEN" | jq .
```

Expected: structured comment list.

### M-02 Set comment status visible/hidden/deleted

1. Pick comment ID.
2. POST action to `/api/admin/comments/:id`.
3. Verify via public comment API.

Expected: status reflected.

### M-03 Ban create/delete lifecycle

1. Create ban via `/api/admin/bans`.
2. Confirm in `/api/admin/bans`.
3. Delete with `/api/admin/bans?id=...`.

Expected: lifecycle works end-to-end.

### M-04 Digest endpoint

Call `/api/admin/digest`.
Expected: coherent counters.

### M-05 Maintenance cleanup

Call `/api/admin/maintenance`.
Expected: cleanup runs, authorized only.

### M-06 Audit logging

- Perform admin action and verify new record exists in `moderation_audit` table (via D1 query).

## Resilience/Failure (`R-*`)

### R-01 Turnstile outage fail-closed

Local:

- Temporarily set bad `TURNSTILE_SECRET_KEY`.
- Retry comment submit.
  Staging:
- Use dedicated staging secret override for drill window.
  Expected: comment/reply blocked.

### R-02 D1 transient failure

Local:

- Stop/misbind D1 for one run and hit writes.
  Staging:
- Simulate by routing to invalid binding in controlled window.
  Expected: safe errors; no sensitive leaks.

### R-03 KV unavailable

- Run without KV binding (local drill) or staging test lane with disabled KV.
  Expected: deterministic behavior + logs.

### R-04 Missing secrets

- Remove required secret in local/staging drill lane.
  Expected: critical write paths blocked safely.

## Performance (`P-*`)

### P-01 Write-path latency P95 < 500ms

Local:

- Use repeated curl timing or lightweight load script on:
  - `POST /api/reactions`
  - `POST /api/comments`
    Staging:
- Run same workload against staging.
  Expected: P95 under 500ms for normal load profile.

### P-02 Read-path responsiveness

- Measure `GET /api/reactions/me` and `GET /api/comments` during page load.
  Expected: no noticeable UI blocking; acceptable response times.

---

## 4) Creative Adversarial Scenarios (How-To)

### C-01 Replay attack

- Capture cookie jar from valid session.
- Replay with modified UA or alternate network.
- Expect request rejection.

### C-02 Cross-origin forgery

- Send writes with unapproved `Origin`.
- Expect rejection.

### C-03 Spam storm

- Submit repeated payloads with links/character spam.
- Expect hold/rate-limit outcomes.

### C-04 Name collision storm

- Submit many blank-name comments quickly.
- Expect generated names and suffixes without unsafe content.

### C-05 Admin probing

- Hit admin endpoints with missing Access email, invalid service token, bad method.
- Expect rejection and no unauthorized side effects.

---

## 5) RC Checklist Template

- Release ID:
- Commit SHA:
- Environment:
- Tester:
- Start time:
- End time:

### Required pass list

- [ ] `F-01` to `F-06`
- [ ] `S-01` to `S-09`
- [ ] `A-01` to `A-07`
- [ ] `M-01` to `M-06`
- [ ] `R-01` and `R-02`
- [ ] `P-01`

### Results log

- Passes:
- Failures:
- Defects filed:
- Mitigations/workarounds:
- Release decision: PASS / BLOCKED
- Sign-off timestamp:

## 6) Monthly Incident Drill Playbook

Run in staging once per month:

1. Turnstile outage simulation
2. Session replay/binding mismatch simulation
3. Burst abuse simulation
4. Admin auth boundary simulation

Record:

- Detection time
- Containment action
- Recovery time
- Follow-up fixes

## 7) Automation Roadmap

### Phase 1

- API smoke scripts for key `F-*`, `S-*`, `A-*`
- Admin auth negative tests

### Phase 2

- Browser automation for comment/reaction UI and reply depth
- Turnstile mock/stub lane for deterministic automation

### Phase 3

- Scheduled security suite on staging
- Performance trend tracking dashboards

## 8) Severity and Triage

- Sev-1: auth bypass, moderation bypass, secret/data compromise
- Sev-2: enforcement control broken (rate limit/ban/session binding)
- Sev-3: functional but non-critical regressions
- Sev-4: cosmetic issues

Release rule: unresolved Sev-1/Sev-2 blocks production release.

## 9) Evidence Retention

Per RC and drill, retain:

- checklist with timestamps
- sanitized request/response evidence
- screenshots where relevant
- remediation notes and owner
