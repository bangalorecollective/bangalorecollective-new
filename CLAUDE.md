# Bangalore Collective — VPS version

This repo is the Bangalore Collective shop and admin panel moved off Supabase onto the owner's own
Hostinger VPS (PostgreSQL + PostgREST + Next.js + Caddy). Same pages and design as the original.
Full plan, status and decisions: `deploy/README.md`. The 2 November 2026 chat that built it is saved
privately on the owner's Mac at `~/bangalorecollective-backup-secrets/chat-2026-11-02/`.

## Where things are

| What | Where |
|---|---|
| This code | `/Users/devendranvt/bangalorecollective-new`, GitHub `bangalorecollective/bangalorecollective-new` (private) |
| Old code, still feeding the live site | `/Users/devendranvt/bangalorecollective` → Vercel + Supabase. Do not change it for VPS work. |
| VPS | Hostinger KVM 4, Ubuntu 26.04, `201.18.206.138`, root via `~/.ssh/bangalorecollective_vps` |
| Server folder | `/opt/bangalorecollective` (`.env`, `docker-compose.yml`, `Caddyfile`, `app-src/`, `uploads/`, `sql/`, `tests/`) |
| Test site | https://staging.bangalorecollective.com (page lock + noindex) |
| Owner tools | https://tools.bangalorecollective.com/pgadmin/ and `/files/` (own page lock) |
| Backups and logins (never in git) | `~/bangalorecollective-backup-secrets/` on the Mac; encrypted database copy on Google Drive |

## Everyday commands

- Put code on the VPS: `./deploy/deploy.sh` (type-checks, copies, rebuilds; site down a few seconds).
- Database access rules check (on the VPS): `cd /opt/bangalorecollective && ./tests/check-access.sh`
- Sign-in and upload checks: `deploy/tests/check-app.sh` (see the header for the variables).
- Local run: open the SSH tunnel in `deploy/README.md`, then `npx next dev --webpack -p 3100`.

## Rules

- Never touch the live site, the live Supabase database, or the old repo unless the owner asks.
  Reading live Supabase is allowed only inside `BEGIN READ ONLY` (the pooler ignores PGOPTIONS).
- Never commit or push without being asked. Never commit secrets, `.env*`, database dumps,
  uploads or customer data. `envfile`, `email and password`, `release.keystore` and
  `raw_base64.txt` exist on disk from the old project and are git-ignored; keep it that way.
- Never print passwords or keys in the chat; hand them over with `pbcopy` or the secrets folder.
- Do not edit `/opt/bangalorecollective/.env` passwords by hand: most also live in database roles.
- Never pick a Hostinger "OS & Panel" template on this VPS: it reinstalls and erases the server.
- New tables are locked by default: add grants and policies, then `notify pgrst, 'reload schema'`.
- Keep `tests/check-access.sh` passing after any change to access rules.
- Future projects moved to a VPS: propose and use a control panel (Coolify/Dokploy for Node +
  Postgres, CloudPanel for PHP) on an empty VPS before any setup. Not for this VPS.

## The owner

Prefers short, plain-English answers with clear steps, tables over long paragraphs, and being
asked before anything that affects the live site, DNS or payments. Decisions they make are final;
do not re-argue them (for example the old repo stays public for now).

## Still to do (as of 2 November 2026)

- Owner: test the staging site; create a Google Cloud OAuth client for backups; decide on the
  checkout-totals fix and the subadmin menu; choose a go-live day.
- Claude: daily encrypted backups to Google Drive (needs the OAuth client); VPS hardening
  (key-only SSH, automatic security updates, uptime alert); checkout totals on the server if
  approved; go-live script and real email (new Gmail app password, `MAIL_MODE=send`).
- Go-live: pause orders, final copy of data and files from Supabase (re-run
  `sql/030_storage_links.sql`), switch the Caddyfile to the real domain without the page lock,
  point `@` and `www` at the VPS, test the site and the Android app, keep Supabase and Vercel for
  a few weeks.
- After go-live: change the Gmail app password and Razorpay secret (in the old public repo); fix the
  two products that have videos as photos; update `.github/workflows/android_build.yml`.
