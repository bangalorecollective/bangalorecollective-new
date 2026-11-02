#!/bin/bash
# End-to-end checks of sign-in, the REST gateway and uploads against a running copy of the site.
#
#   BASE=http://localhost:3100 ADMIN_EMAIL=... ADMIN_PASSWORD=... SERVER_LOG=path ./check-app.sh
#
# SERVER_LOG is the site's output, where confirmation links appear while MAIL_MODE is not "send".
# Creates one test customer named staging-check-<time>@example.com (printed at the end, remove it
# from auth.users afterwards) and one test upload, which it deletes.
set -uo pipefail
B=${BASE:?BASE}
J=$(mktemp -d)
pass=0; fail=0
ok() { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1 :: $2"; }
expect() { # name, expected-code, actual-code, [detail]
  [ "$2" = "$3" ] && ok "$1" || bad "$1" "expected HTTP $2, got $3 ${4:-}"
}
req() { # jar, area, method, url, [data] -> prints code; body in $J/body
  local jar=$1 area=$2 method=$3 url=$4 data=${5:-}
  # The body goes through a file: macOS ships bash 3.2, which mangles optional arguments.
  printf '%s' "$data" > "$J/data"
  if [ -n "$data" ]; then
    curl -s -o "$J/body" -w '%{http_code}' -b "$J/$jar" -c "$J/$jar" -X "$method" \
      -H "x-app-area: $area" -H 'content-type: application/json' --data-binary "@$J/data" "$B$url"
  else
    curl -s -o "$J/body" -w '%{http_code}' -b "$J/$jar" -c "$J/$jar" -X "$method" \
      -H "x-app-area: $area" "$B$url"
  fi
}
touch "$J/anon" "$J/admin" "$J/cust"

echo "== admin"
expect "admin page redirects when signed out" 307 "$(curl -s -o /dev/null -w '%{http_code}' "$B/dashboard/")"
expect "wrong admin password refused" 401 "$(req anon storefront POST /api/auth/admin/login '{"email":"nobody@example.com","password":"x"}')"
c=$(req admin storefront POST /api/auth/admin/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
expect "admin signs in" 200 "$c"
grep -q bc_admin "$J/admin" && ok "admin cookie set" || bad "admin cookie set" "no cookie"
expect "admin session recognised" 200 "$(req admin admin GET /api/auth/admin/session/)"
grep -q '"role":"master-admin"' "$J/body" && ok "role is master-admin" || bad "role is master-admin" "$(cat "$J/body")"
expect "admin page opens when signed in" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J/admin" "$B/dashboard/")"
expect "admin reads customers via gateway" 200 "$(req admin admin GET '/api/rest/customers?select=id&limit=3')"
expect "admin customer list API" 200 "$(req admin admin GET /api/customers/)"
python3 -c "import json,sys; n=len(json.load(open('$J/body'))['users']); sys.exit(0 if n>50 else 1)" && ok "customer list has more than 50 (Supabase stopped at 50)" || bad "customer list size" "$(head -c 200 "$J/body")"
expect "admin POS customer search" 200 "$(req admin admin GET '/api/users/?query=a')"
expect "update without a filter refused" 400 "$(req admin admin PATCH /api/rest/products '{"name":"x"}')"

echo "== visitor"
expect "visitor reads products" 200 "$(req anon storefront GET '/api/rest/products?select=id&limit=2')"
expect "visitor cannot read orders" 401 "$(req anon storefront GET '/api/rest/orders?select=id')"
expect "admin header without admin cookie gives no admin rights" 401 "$(req anon admin GET '/api/rest/customers?select=id')"
expect "visitor cannot use customer list API" 401 "$(req anon admin GET /api/customers/)"
expect "visitor cannot send status emails" 401 "$(req anon admin POST /api/send-status-email/ '{"orderId":"x"}')"
expect "visitor cannot send order emails" 401 "$(req anon storefront POST /api/send-customer-order-email/ '{"orderId":"x"}')"
expect "visitor cannot change site info" 401 "$(req anon admin POST /api/site-info/ '{"type":"texts"}')"
expect "visitor cannot upload" 401 "$(curl -s -o /dev/null -w '%{http_code}' -F bucket=product-images -F path=x.png -F 'file=@/dev/null;type=image/png' "$B/api/storage/upload/")"

echo "== customer"
EMAIL="staging-check-$(date +%s)@example.com"
c=$(req cust storefront POST /api/auth/customer/signup/ "{\"email\":\"$EMAIL\",\"password\":\"check-pass-123\",\"data\":{\"phone\":\"9999999999\"}}")
expect "signup" 200 "$c"
c=$(req cust storefront POST /api/auth/customer/login/ "{\"email\":\"$EMAIL\",\"password\":\"check-pass-123\"}")
expect "login before confirming refused" 400 "$c"
grep -q "Email not confirmed" "$J/body" && ok "same message as Supabase" || bad "same message as Supabase" "$(cat "$J/body")"
sleep 1
LINK=$(grep -oE "\[mail link\] [^ ]+confirm\?token=[A-Za-z0-9_-]+" "${SERVER_LOG:?SERVER_LOG}" | tail -1 | cut -d' ' -f3)
[ -n "$LINK" ] && ok "confirmation email written to log (not sent)" || bad "confirmation link" "none in log"
CONFIRM_PATH=${LINK#*://*/}
expect "confirmation link signs in" 307 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J/cust" -c "$J/cust" "$B/$CONFIRM_PATH")"
expect "confirmation link works only once" 307 "$(curl -s -o /dev/null -w '%{http_code}' "$B/$CONFIRM_PATH")"
expect "customer session" 200 "$(req cust storefront GET /api/auth/customer/session/)"
USER_ID=$(python3 -c "import json; print(json.load(open('$J/body'))['session']['user']['id'])")
[ -n "$USER_ID" ] && ok "session has user id" || bad "session user" "$(cat "$J/body")"
expect "profile row created by trigger" 200 "$(req admin admin GET "/api/rest/profiles?select=id&id=eq.$USER_ID")"
grep -q "$USER_ID" "$J/body" && ok "profiles row exists" || bad "profiles row" "$(cat "$J/body")"
expect "customer reads own orders" 200 "$(req cust storefront GET '/api/rest/orders?select=id')"
[ "$(cat "$J/body")" = "[]" ] && ok "new customer sees no orders (none of anyone else's)" || bad "own orders" "$(head -c 100 "$J/body")"
PRODUCT=$(req anon storefront GET '/api/rest/product_variations?select=id,product_id&limit=1' >/dev/null; python3 -c "import json; d=json.load(open('$J/body'))[0]; print(d['product_id'], d['id'])")
set -- $PRODUCT
c=$(req cust storefront POST /api/rest/cart "{\"user_id\":\"$USER_ID\",\"product_id\":$1,\"variation_id\":$2,\"quantity\":1}")
expect "customer adds to own cart" 201 "$c"
expect "customer removes from own cart" 204 "$(req cust storefront DELETE "/api/rest/cart?user_id=eq.$USER_ID")"
expect "customer cannot read customers" 403 "$(req cust storefront GET '/api/rest/customers?select=id')"
expect "customer with admin header still not admin" 403 "$(req cust admin GET '/api/rest/customers?select=id')"
PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
echo "$PNG" | base64 -d > "$J/p.png"
expect "customer uploads own payment proof" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J/cust" -F bucket=payment-proofs -F "path=$USER_ID/check.png" -F "file=@$J/p.png;type=image/png" "$B/api/storage/upload/")"
expect "customer cannot upload into someone else's folder" 403 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J/cust" -F bucket=payment-proofs -F 'path=00000000-0000-0000-0000-000000000000/x.png' -F "file=@$J/p.png;type=image/png" "$B/api/storage/upload/")"
expect "customer cannot upload product images" 403 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J/cust" -F bucket=product-images -F 'path=x.png' -F "file=@$J/p.png;type=image/png" "$B/api/storage/upload/")"
expect "customer opens own payment proof" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J/cust" "$B/storage/v1/object/public/payment-proofs/$USER_ID/check.png")"
expect "visitor cannot open payment proof" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$B/storage/v1/object/public/payment-proofs/$USER_ID/check.png")"
expect "admin opens payment proof" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J/admin" "$B/storage/v1/object/public/payment-proofs/$USER_ID/check.png")"
expect "path escape refused" 404 "$(curl -s -o /dev/null -w '%{http_code}' --path-as-is "$B/storage/v1/object/public/product-images/../../../etc/passwd")"
c=$(req admin admin POST /api/storage/remove/ "{\"bucket\":\"payment-proofs\",\"paths\":[\"$USER_ID/check.png\"]}")
expect "admin deletes the test upload" 200 "$c"
expect "password change" 200 "$(req cust storefront POST /api/auth/customer/update/ '{"password":"check-pass-456"}')"
expect "logout" 200 "$(req cust storefront POST /api/auth/customer/logout/)"
expect "signed out session is gone" 200 "$(req cust storefront GET /api/auth/customer/session/)"
grep -q '"session":null' "$J/body" && ok "no session after logout" || bad "logout" "$(cat "$J/body")"
c=$(req cust storefront POST /api/auth/customer/login/ "{\"email\":\"$EMAIL\",\"password\":\"check-pass-123\"}")
expect "old password refused" 400 "$c"
c=$(req cust storefront POST /api/auth/customer/login/ "{\"email\":\"$EMAIL\",\"password\":\"check-pass-456\"}")
expect "new password works" 200 "$c"
c=$(req admin admin POST /api/customers/ "{\"userId\":\"$USER_ID\",\"block\":true}")
expect "admin blocks the customer" 200 "$c"
expect "blocked customer is signed out" 200 "$(req cust storefront GET /api/auth/customer/session/)"
grep -q '"session":null' "$J/body" && ok "blocked customer has no session" || bad "block" "$(cat "$J/body")"
c=$(req cust storefront POST /api/auth/customer/login/ "{\"email\":\"$EMAIL\",\"password\":\"check-pass-456\"}")
expect "blocked customer cannot sign in" 403 "$c"

echo "== password guessing"
for i in $(seq 1 10); do req anon storefront POST /api/auth/customer/login/ "{\"email\":\"$EMAIL\",\"password\":\"wrong-$i\"}" >/dev/null; done
c=$(req anon storefront POST /api/auth/customer/login/ "{\"email\":\"$EMAIL\",\"password\":\"wrong\"}")
expect "11th wrong password is slowed down" 429 "$c"

echo "TEST_USER_ID=$USER_ID"
echo "passed $pass, failed $fail"
rm -rf "$J"
[ "$fail" = 0 ]
