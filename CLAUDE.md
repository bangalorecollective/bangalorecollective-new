# Bangalore Collective — VPS version

This repo is the Bangalore Collective shop and admin panel moved off Supabase onto the owner's own
Hostinger VPS, managed with **Coolify** (PostgreSQL + PostgREST + Next.js). Same pages and design as
the original. Full plan, status and decisions: `deploy/README.md`. The 2 November 2026 chat that
built it is saved privately on the owner's Mac at `~/bangalorecollective-backup-secrets/chat-2026-11-02/`.

## Where things are

| What | Where |
|---|---|
| This code | `/Users/devendranvt/bangalorecollective-new`, GitHub `bangalorecollective/bangalorecollective-new` (private) |
| Old code, still feeding the live site | `/Users/devendranvt/bangalorecollective` (GitHub `bangalorecollective/bangalorecollective`) → Vercel + Supabase. Never change it for VPS work. |
| VPS | Hostinger KVM 4, Ubuntu 24.04, `201.18.206.138`, root via `~/.ssh/bangalorecollective_vps` |
| Coolify dashboard | http://201.18.206.138:8000, project **Bangalore Collective**, environment `production` |
| Coolify resources | `database` (PostgreSQL 18.6, container `kawcqgosgyvloyd70yg8heem`), `postgrest` (`tqlctupjywddrzo8kdjd1uly`), `website` (`cd8f33u9hk1oqet5kiubfban`), `owner-tools` service |
| Server files | `/data/bangalorecollective/` (`uploads/`, `image-cache/`, `tools/`, `filebrowser/`, `ops.env`) |
| Test site | https://staging.bangalorecollective.com (page lock + noindex) |
| Owner tools | https://tools.bangalorecollective.com (launcher, `/pgadmin/`, `/files/`; own page lock) |
| Backups and logins (never in git) | `~/bangalorecollective-backup-secrets/` on the Mac (`coolify-rebuild.env` holds the Coolify-era passwords) |

## Everyday commands

- Put code on the VPS: **push to `main`**. Coolify's GitHub App (`bangalorecollective`) sees the push
  and rebuilds the `website` app from the `Dockerfile`. After go-live this updates the real shop.
  Settings (env vars, domain, page lock) are in the `website` app in Coolify.
- The build has no database access: no page may read the database at build time
  (`export const dynamic = "force-dynamic"`, cache with `unstable_cache` instead of `revalidate`).
- Scripts in `deploy/` run on the VPS and read container names and secrets from
  `/data/bangalorecollective/ops.env` (root only). Copy them over with
  `rsync -a deploy/ root@201.18.206.138:/root/deploy/`.
- Database access rules check: `bash /root/deploy/tests/check-access.sh` (on the VPS).
- Sign-in and upload checks: `deploy/tests/check-app.sh` (see the header for the variables).
- The Coolify API token is in `~/bangalorecollective-backup-secrets/COOLIFY-API-TOKEN.txt`.
  Resetting the Coolify password deletes every API token.

## Rules

- Never touch the live site, the live Supabase database, or the old repo unless the owner asks.
  Reading live Supabase is allowed only inside `BEGIN READ ONLY` (the pooler ignores PGOPTIONS).
- Never commit or push without being asked. Never commit secrets, `.env*`, database dumps,
  uploads or customer data. `envfile`, `email and password`, `release.keystore` and
  `raw_base64.txt` exist on disk from the old project and are git-ignored; keep it that way.
- Never print passwords or keys in the chat; hand them over with `pbcopy` or the secrets folder.
  Send API bodies with secrets over stdin: a failed `curl --data` echoes its argument.
- Database role passwords (`authenticator`, `app_server`, `viewer`, `editor`) also live in Coolify
  env vars and `ops.env`; change both together.
- A Hostinger "OS & Panel" template reinstalls and erases the server; only the owner clicks it.
- New tables are locked by default: add grants and policies, then `notify pgrst, 'reload schema'`.
- Keep `tests/check-access.sh` passing after any change to access rules.
- Coolify gives every new app a public `sslip.io` address; clear it for anything private (PostgREST).
- Apps that others reach by name need "consistent container name" on, or the name changes per deploy.
- VPS projects use a control panel (Coolify/Dokploy for Node + Postgres, CloudPanel for PHP),
  chosen on an empty VPS before any setup.
- The owner's Mac connection drops for a few seconds at a time; retry SSH and API calls.

## Coolify rebuild (3 November 2026)

| Step | State |
|---|---|
| VPS reinstalled with Hostinger's Coolify template, onboarding on Localhost | done |
| `database`: 2 Nov backup restored (64/64 tables match), `sql/010…050` applied, staging admin recreated | done |
| `postgrest`: private, no domain, fixed container name | done |
| `owner-tools`: tools.bangalorecollective.com with HTTPS, same logins as before | done |
| Access rules check on the new database | done, 41/41 |
| `website`: GitHub App, domain, page lock, env vars, upload folders, auto-deploy | configured; first build waits for this push |
| Uploads (25 GB) copied from the Mac backup to `/data/bangalorecollective/uploads` | in progress |
| Then: `warm-image-cache.mjs`, `check-app.sh`, the 61-page browser check | to do |
| Then: Coolify scheduled database backups | to do |

Open on the server: UFW inactive; public ports 22, 80, 443, 8000 (dashboard), 8080, 6001, 6002; root
password login enabled; a reboot is pending for updates. Put the dashboard on HTTPS at its own
domain (needs a DNS record, ask first), then close 8000/8080/6001/6002 (Docker-published ports
bypass UFW). Hostinger's web console appends a temporary `expiry-time=...` key without a trailing
newline, so always add keys to `authorized_keys` with a leading newline.

On GitHub, the old read-only deploy key "vps ready-only" and the `VPS_DEPLOY_KEY` secret belonged to
the wiped server; remove them (ask first). The Coolify GitHub App can also see the live repo; the
owner was asked to limit it to `bangalorecollective-new`.

## The owner

Prefers short, plain-English answers with clear steps, tables over long paragraphs, and being
asked before anything that affects the live site, DNS or payments. Decisions they make are final;
do not re-argue them (for example the old repo stays public for now). New to terminals: say which
terminal (Mac or server), and give paste-once commands.

## Still to do after the Coolify rebuild

- Owner: test the staging site; create a Google Cloud OAuth client for backups; decide on the
  checkout-totals fix and the subadmin menu; choose a go-live day.
- Claude: daily encrypted backups to Google Drive (needs the OAuth client); VPS hardening
  (key-only SSH, firewall, automatic security updates, uptime alert); checkout totals on the server
  if approved; go-live script and real email (new Gmail app password, `MAIL_MODE=send`).
- Go-live: pause orders, final copy of data and files from Supabase (re-run
  `sql/030_storage_links.sql`), in Coolify switch the `website` domain to the real one, turn off its
  page lock and remove `NOINDEX`, point `@` and `www` at the VPS, test the site and the Android app,
  keep Supabase and Vercel for a few weeks.
- After go-live: change the Gmail app password and Razorpay secret (in the old public repo); fix the
  two products that have videos as photos; update `.github/workflows/android_build.yml`.
