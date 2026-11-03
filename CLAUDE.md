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

- Put code on the VPS: **push to `main`**. GitHub Actions (`.github/workflows/deploy.yml`) type-checks,
  then triggers `deploy/deploy-from-github.sh` on the VPS, which pulls with a read-only deploy key,
  builds, and restores the previous image if the new one does not start. After go-live this updates
  the real shop. `./deploy/deploy.sh` still works for a manual deploy from the Mac.
- The GitHub trigger key in `/root/.ssh/authorized_keys` is restricted to that script; keep it on
  its own line (appending without a newline once glued it onto the previous key).
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
- A Hostinger "OS & Panel" template reinstalls and erases the server; only the owner clicks it.
  Coolify's own install script does not wipe a server. Say which one is meant.
- New tables are locked by default: add grants and policies, then `notify pgrst, 'reload schema'`.
- Keep `tests/check-access.sh` passing after any change to access rules.
- VPS projects use a control panel (Coolify/Dokploy for Node + Postgres, CloudPanel for PHP),
  chosen on an empty VPS before any setup, with pgAdmin and File Browser added from its services.

## Current plan (decided 2–3 November 2026): rebuild this VPS on Coolify

The owner wants to manage everything from a dashboard (settings form, database, files, deploys),
so the hand-built setup described in `deploy/README.md` is being replaced:

1. Done: Hostinger snapshot taken 2026-11-02 21:27, **expires 2026-11-03** (undo only until then).
2. Done 2026-11-03: VPS reinstalled with Hostinger's **Coolify** template: Ubuntu 24.04.5, Coolify
   containers healthy (coolify, coolify-db, coolify-redis, coolify-proxy, coolify-sentinel). The old
   `/opt/bangalorecollective` setup is gone. The SSH host key changed (the Mac's known_hosts was updated).
3. Done: the owner created the Coolify admin account (sign-up page now closed) and finished the
   onboarding with **Localhost**. Their login is theirs; do not ask for it.
   Claude's key (`~/.ssh/bangalorecollective_vps`) is in `/root/.ssh/authorized_keys` and works.
   Hostinger's web console appends a temporary `expiry-time=...` key **without a trailing newline**,
   so anything appended after it gets glued on: always add keys with a leading newline.
   Still open on the server: UFW inactive; public ports 22, 80, 443, 8000 (dashboard), 8080, 6001,
   6002; root password login enabled; a reboot is pending for updates. Put the dashboard on HTTPS
   at its own domain, then close 8000/8080/6001/6002 (remember Docker-published ports bypass UFW).
4. Rebuild inside Coolify, so everything shows in its dashboard: PostgreSQL 18 resource (restore
   `~/bangalorecollective-backup-secrets/db-2026-11-02/full.dump`, then `deploy/sql/010…050`);
   PostgREST v16.4 as an app; the website from the GitHub repo with env vars in Coolify's form;
   uploads as persistent storage (copy from `~/bangalorecollective-backup-secrets/files-2026-11-02/`,
   re-run `sql/030_storage_links.sql`, then `warm-image-cache.mjs`); domains `staging.` and
   `tools.` with HTTPS and page locks; pgAdmin and File Browser from Coolify services; Coolify's
   GitHub deploy (then remove `.github/workflows/deploy.yml` and the `VPS_DEPLOY_KEY` secret);
   scheduled database backups. The home page pre-renders from the database at build time; make it
   render on request instead, since Coolify builds without database access.
5. Re-run `tests/check-access.sh`, `tests/check-app.sh` and the 61-page browser check before
   telling the owner it is ready. Until then the owner must not push to `main` (the old deploy
   workflow would fail), and staging/tools are down. The live shop (Vercel + Supabase) is unaffected.

## The owner

Prefers short, plain-English answers with clear steps, tables over long paragraphs, and being
asked before anything that affects the live site, DNS or payments. Decisions they make are final;
do not re-argue them (for example the old repo stays public for now).

## Still to do after the Coolify rebuild

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
