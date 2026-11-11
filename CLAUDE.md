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
| Test site | https://staging.bangalorecollective.com (noindex; page lock removed 2026-11-03 at the owner's request, Coolify "HTTP Basic Auth" on the `website` app turns it back on) |
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
- Android: the app only opens https://www.bangalorecollective.com, so go-live needs no new build.
  GitHub Actions has two manual workflows: "Build staging test APK" (debug, app id
  `com.banglorecolletive.app.staging`, name "BC Staging", opens staging, no secrets) and "Build
  Bangalore Collective AAB" (signed release; needs the 4 `ANDROID_*` secrets, which the owner adds
  with `~/bangalorecollective-backup-secrets/set-android-secrets.sh`). Both use Node 24 and the
  runner's own Android SDK.
- The Coolify API token is in `~/bangalorecollective-backup-secrets/COOLIFY-API-TOKEN.txt`.
  Resetting the Coolify password deletes every API token.

## Rules

- Never touch the live site, the live Supabase database, or the old repo unless the owner asks.
  Reading live Supabase is allowed only inside `BEGIN READ ONLY` (the pooler ignores PGOPTIONS).
- Never commit or push without being asked. Never commit secrets, `.env*`, database dumps,
  uploads or customer data. The old project's `envfile` (live Supabase/Razorpay/Gmail keys),
  `release.keystore` (Android signing key: never lose it) and `raw_base64.txt` were moved on
  2026-11-03 to `~/bangalorecollective-backup-secrets/old-project-files/`. `email and password`
  (owner's notes: logins plus website and tools links) lives in `private/owner-notes/` by the
  owner's choice; `/private/` is git- and docker-ignored. All four names stay git-ignored too.
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
| `website`: GitHub App, domain, page lock, env vars, upload folders, auto-deploy | done; push to `main` builds in ~70 s |
| Uploads copied to `/data/bangalorecollective/uploads`, owned by 1001 | done, 3,686 files, checksums match the Mac backup |
| `warm-image-cache.mjs` | done, 12,464 images, 0 failed |
| `check-app.sh` (run on the VPS; from the Mac, dropped connections show as `000`) | done, 55/55 |
| 61-page browser check (Playwright) | done; 3 flagged, all as on live: .mp4 "photos" on a category page, wishlist 406, missing `offers` table |
| Coolify database backups | done, nightly 21:00 UTC (02:30 IST), 14 kept on the VPS only |
| Full order on a phone-sized screen (bag → cart → checkout → proof → finalize), seen in admin | done; test order, customer and stock change undone afterwards |

Gmail: the old app password stopped working (it was in the old public repo). A new one was made on
2026-11-03 (`~/bangalorecollective-backup-secrets/GMAIL-APP-PASSWORD.txt`), tested from the VPS
(SMTP 465 login and one email to the shop inbox), and set as `EMAIL_USER`/`EMAIL_PASS` on the
`website` app. Staging stays `MAIL_MODE=log`, because it holds real customers; switch to `send`
at go-live. The live site (Vercel) may still have the old password; only update it if asked. Checkout is bank
transfer with a payment proof; nothing calls `/api/create-razorpay-order`, so no Razorpay keys are
needed. The admin order page shows "GST 18%" that is not added to the total: original shop code.

Staging is ready for the owner to test. Go-live is planned for 1–2 weeks out, only when the owner
says so; Google Drive backups are on hold until the owner brings them up.

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

- Owner: test the staging site; create a Google Cloud OAuth client for backups; choose a go-live day.
- Decided 2026-11-03: the site must behave exactly like live. The GST 18% line, browser-computed
  checkout totals and the subadmin menu are the same on live, so they stay as they are.
- Claude: daily encrypted backups to Google Drive (needs the OAuth client); VPS hardening
  (key-only SSH, firewall, automatic security updates, uptime alert); checkout totals on the server
  if approved; go-live script and real email (new Gmail app password, `MAIL_MODE=send`).
- Go-live: pause orders, final copy of data and files from Supabase (re-run
  `sql/030_storage_links.sql`), in Coolify switch the `website` domain to the real one and remove
  `NOINDEX` (then redeploy, it is read at build time), point `@` and `www` at the VPS, test the site and the Android app,
  keep Supabase and Vercel for a few weeks.
- **Went live 10 November 2026, ~16:05 IST.** Live copy taken 15:49 IST (66/66 tables, checks
  41/41 and 55/55, 53 pages clean on www). The website app now serves www + bare domain (redirect to
  www, Let's Encrypt), `MAIL_MODE=send`, `NOINDEX=0`. DNS: `@` and `www` A → 201.18.206.138. The
  pre-go-live database is kept as `bangalorecollective_staging_20261110`; the `staging` DNS record
  now leads nowhere (delete it or point a new app at it). Vercel + Supabase stay untouched as the
  fallback for a few weeks (rollback: `@` A 216.198.79.1, `www` CNAME
  04d3fd40643577d5.vercel-dns-017.com).
- Go-live rehearsal, 6 November 2026 (stopped by the owner before the DNS change; staging settings
  restored): staging now holds a live copy taken at 18:06 IST (66/66 tables, checks 41/41 and
  55/55); the previous staging database is kept as `bangalorecollective_staging_20261106`. The
  local old-repo folder is gone, so the live connection is in
  `~/bangalorecollective-backup-secrets/SUPABASE-DB-URL.txt` (session pooler, read only). Every
  bucket is public: new files download from their public URLs (`fetch-new-files.sh`), no keys.
  `/root/import-1106/golive-db.sh` renames the current database and restores a fresh dump with
  `sql/010…050` and the admin; it needs a new dump, `counts-before.tsv` and `SHA256SUMS` each time.
  Coolify switch: domains `https://www.bangalorecollective.com,https://bangalorecollective.com`,
  redirect `www`, `SITE_URL` real domain, `MAIL_MODE=send`, `NOINDEX=0`, redeploy. DNS (Hostinger,
  TTL 1200): `@` A 216.198.79.1 → VPS, delete the `www` CNAME to Vercel and add `www` A → VPS.
  An empty test folder `uploads/payment-proofs/7c3b686b-…` is left to delete by hand.
- After go-live: change the Gmail app password and Razorpay secret (in the old public repo); fix the
  two products that have videos as photos; update `.github/workflows/android_build.yml`.
