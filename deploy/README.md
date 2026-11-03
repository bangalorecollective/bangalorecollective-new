# Moving Bangalore Collective from Supabase to the VPS

This repo runs the same site on the Hostinger VPS with its own PostgreSQL and no Supabase service
at all, managed with Coolify (rebuilt there on 3 November 2026). The live site (old repo, Vercel and
Supabase) is not touched by anything here.

## How it fits together

```
browser ──HTTPS──▶ Coolify proxy (Traefik) ──▶ website (Next.js) ──▶ /api/rest proxy ──▶ postgrest ──▶ database
                                                    ├─▶ /api/auth, /api/storage
                                                    └─▶ /storage/v1/object/public/<bucket>/<path>
                                                          (files in /data/bangalorecollective/uploads)
```

- **Coolify** (http://201.18.206.138:8000) runs everything as one project, "Bangalore Collective":
  `database` and `postgrest` are private (no domain), `website` builds from GitHub `main` on every
  push, `owner-tools` serves tools.bangalorecollective.com. Traefik gets the HTTPS certificates.

- **PostgreSQL 18** holds the data restored from Supabase, with the same tables, columns, IDs and
  functions. Customer accounts stay in `auth.users` with their existing bcrypt password hashes.
- **PostgREST** (independent open-source project, not Supabase software) answers the same query
  syntax the pages already use (`.from().select().eq()...`), so pages keep their queries.
- **Security** is enforced by PostgreSQL row level security, rewritten from scratch in
  `sql/010_security.sql`. The app signs a short-lived JWT for each request with one of three
  roles: `anon` (visitor), `authenticated` (customer, `auth.uid()` = their id) or `admin_user`.
- **Pages** import one replacement client instead of `@supabase/supabase-js`; it talks only to
  this site's own `/api/...` routes.

## Status

| Step | State |
|---|---|
| Staging database on the VPS, restored from the 2026-11-02 backup | done, 64/64 tables match |
| PostgREST answers every query style the pages use (joins, counts, `or`, `!inner`, 1000-row cap) | done |
| New access rules (`sql/010_security.sql`) | done, 41/41 checks pass (`tests/check-access.sh`) |
| Sign-in tables, hashed subadmin passwords (`sql/020_app_auth.sql`) | done |
| Replacement client (`lib/db/client.ts`), REST gateway, customer and admin sign-in, uploads | done, 55/55 checks pass (`tests/check-app.sh`) |
| Every page switched off `@supabase/*`; no Supabase URL or key left in the code | done |
| Every page opened in headless Chrome as visitor, customer and admin (61 pages) | done; 59 clean, 2 behave as on the live site |
| Every image pre-resized at 128/384/640/768 px (`warm-image-cache.mjs`) | done, 12,464 images |
| Live Supabase compared with the VPS (rows, columns, functions, files) | done; structure and files identical, only orders/sign-ups since 12:16 differ |
| File backup on the Mac, checked file by file against Supabase | done, 3,686 files, 0 differences |
| Stored links point at this server (`sql/030_storage_links.sql`) | done on staging, 2,971 links |
| Image resizing on the server (`app/api/image`), cached on disk | done (494 KB photo → 29 KB WebP) |
| Files copied to the VPS (`/data/bangalorecollective/uploads`) | done before the rebuild; copied again for Coolify |
| Site running on the VPS at https://staging.bangalorecollective.com (page password, noindex) | done, 55/55 checks pass there |
| Rebuilt on Coolify: database restored again (64/64 tables), access rules 41/41 | done 2026-11-03 |
| Daily encrypted backups to Google Drive | before go-live |
| Final copy of live data, DNS switch | last, only with approval |

## Files

| File | What it does |
|---|---|
| `restore-from-supabase.sh` | Loads a Supabase backup; refuses to run over existing tables |
| `sql/010_security.sql` | Every table grant and access rule; safe to run again |
| `tests/check-access.sh` | Tries reads and writes as visitor, customer and admin; all writes roll back |
| `sql/020_app_auth.sql` | Sessions, master admin, email links, failed sign-ins, `app_server` role |
| `set-admin-password.sh` | Creates the master admin or changes its password |
| `tests/check-app.sh` | Sign-in, gateway and upload checks against a running site |
| `coolify/tools-compose.yml` | The `owner-tools` service in Coolify: Caddy launcher, pgAdmin, File Browser |
| `coolify/tools.Caddyfile` | Page lock and routes for the tools; the VPS copy holds the real hash |
| `coolify/pgadmin-servers.json` | pgAdmin's two database entries (viewer and editor) |
| `launcher.html` | The tools home page |
| `warm-image-cache.mjs` | Pre-resizes every uploaded image at the common sizes |
| `sql/040_viewer_role.sql` | Read-only `viewer` login that pgAdmin uses |
| `sql/050_editor_role.sql` | `editor` login for pgAdmin: changes rows, cannot drop tables or manage roles |

The scripts run on the VPS and read container names and secrets from
`/data/bangalorecollective/ops.env` (root only, never committed).

## Owner tools

At https://tools.bangalorecollective.com, behind its own page lock (kept after go-live), then each
tool's own sign-in. Credentials are in the owner's `SERVER-TOOLS-LOGIN.txt`, never in git.

- `/pgadmin/` — pgAdmin 9.18, connected as `viewer`: reads every table, every session is read-only.
  Server entries from `/data/bangalorecollective/tools/servers.json`; pgAdmin asks for the database
  password.
  A second entry, "Bangalore Collective (editor)", signs in as `editor` (`sql/050_editor_role.sql`):
  reads and writes every row and can create tables in public, but cannot alter or drop existing
  tables, drop the database or manage roles.
- `/files/` — File Browser 2.63, the `uploads` folder mounted read-only; the `owner` user can view
  and download only. Its user database is `/data/bangalorecollective/filebrowser/`.

To update the site, push to `main`; Coolify rebuilds and restarts the `website` app. After copying
files into `/data/bangalorecollective/uploads`, run `chown -R 1001:1001` on it so the app can read
and write them.

## Running it locally

`.env.local` (never committed) points at the VPS through an SSH tunnel and has no Supabase keys.
The database and PostgREST have no public ports, so tunnel to their Docker network addresses
(they can change when a container is recreated):

```
ip() { ssh -i ~/.ssh/bangalorecollective_vps root@<vps> docker inspect -f '{{(index .NetworkSettings.Networks "coolify").IPAddress}}' "$1"; }
ssh -i ~/.ssh/bangalorecollective_vps -N -L 54329:$(ip kawcqgosgyvloyd70yg8heem):5432 -L 30019:$(ip tqlctupjywddrzo8kdjd1uly):3000 root@<vps>
npx next dev --webpack -p 3100
```

With `MAIL_MODE` anything but `send`, emails are written to the server log instead of sent.

On the VPS the settings live in each Coolify resource's environment variables.

## Changes in behaviour, on purpose

- Visitors can no longer read orders, customers, contact messages, coupons or any admin passwords,
  and can no longer change products, prices, orders, banners or payment details.
- Customers see and change only their own cart, wishlist, likes and orders, and new orders always
  start as `pending` / `placed`. Only an admin can mark an order paid or shipped.
- Product pages show reviewer names but no longer load reviewer email addresses.
- `increment_video_stat` (unused by the site) is admin-only, because it could change any column.
- Supabase refused `UPDATE`/`DELETE` without a filter (`pg-safeupdate`). The REST proxy keeps that rule.
- The admin password is no longer written in the login page, and subadmin passwords are stored hashed.
  Admin pages check the session on the server, not just a flag in the browser.
- "Block customer" now actually stops the customer signing in (on Supabase it only changed a label).
- The admin customer list and POS search cover every customer (Supabase's list stopped at 50).
- Password reset emails link to this site (the live site sends them to an old Vercel address).
- The email routes need a signed-in customer or admin, and send only to the address on the order.
- Uploaded payment proofs can only be opened by that customer or an admin.
- Ten failed sign-ins for one email, or fifty from one network address, within 15 minutes pause
  sign-in for that email or address until the 15 minutes pass.

## Left as it was, to decide later

- Subadmins see the full admin menu. The sidebar has a shorter subadmin menu, but the login page
  saves the role under `role` while the layout reads `userRole`, so it never applies (same on the
  live site). Fixing it would hide some menus from subadmins.

## Known risks still open

- Checkout totals, coupon discounts and the bag/box price are calculated in the browser and saved
  as sent. Payment is approved by hand, so an admin should check the amount; moving the calculation
  to the server is recommended.
- Any signed-in customer can list all coupon codes, as on Supabase. Checking a code on the server
  instead would hide them.
- `decrement_product_stock` can be called by any signed-in customer with any items, as on Supabase.
