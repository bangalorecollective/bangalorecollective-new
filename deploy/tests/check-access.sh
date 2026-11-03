#!/bin/bash
# Checks who can read and change what through PostgREST, as a visitor, a customer and an admin.
# Run on the VPS (container names and JWT_SECRET come from /data/bangalorecollective/ops.env).
# Every write uses "Prefer: tx=rollback", so
# nothing is saved. Exits non-zero if any check does not match what is expected.
set -uo pipefail
set -a; . /data/bangalorecollective/ops.env; set +a
# PostgREST has no public port; reach it on its Docker network address.
B=${REST_URL:-http://$(docker inspect -f '{{(index .NetworkSettings.Networks "coolify").IPAddress}}' "$REST_CONTAINER"):3000}
PSQL=(docker exec -i "$DB_CONTAINER" psql -U postgres -d bangalorecollective -At)

jwt() { # role, sub
  python3 - "$1" "$2" <<'PY'
import base64, hashlib, hmac, json, os, sys, time
role, sub = sys.argv[1], sys.argv[2]
enc = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
h = enc(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
claims = {"role": role, "exp": int(time.time()) + 600}
if sub: claims["sub"] = sub
p = enc(json.dumps(claims).encode())
s = enc(hmac.new(os.environ["JWT_SECRET"].encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())
print(f"{h}.{p}.{s}")
PY
}

CUSTOMER=$("${PSQL[@]}" -c "select user_id from orders where user_id is not null group by user_id order by count(*) desc limit 1")
OTHERS=$("${PSQL[@]}" -c "select count(*) from orders where user_id <> '$CUSTOMER'")
OWN=$("${PSQL[@]}" -c "select count(*) from orders where user_id = '$CUSTOMER'")
PRODUCT=$("${PSQL[@]}" -c "select id from products order by id limit 1")
T_CUSTOMER=$(jwt authenticated "$CUSTOMER")
T_ADMIN=$(jwt admin_user "")

pass=0; fail=0
check() { # name, expected (allow|deny|rows=N), who, method, path, [body]
  local name=$1 expect=$2 who=$3 method=$4 path=$5 body=${6:-} ret=${7:-representation}
  local auth=()
  [ "$who" = customer ] && auth=(-H "Authorization: Bearer $T_CUSTOMER")
  [ "$who" = admin ] && auth=(-H "Authorization: Bearer $T_ADMIN")
  local code
  code=$(curl -s -o /tmp/check.json -w '%{http_code}' -X "$method" "${auth[@]}" \
    -H 'Content-Type: application/json' -H "Prefer: tx=rollback, return=$ret, count=exact" \
    ${body:+-d "$body"} "$B/$path")
  local rows
  rows=$(python3 -c "import json;d=json.load(open('/tmp/check.json'));print(len(d) if isinstance(d,list) else -1)" 2>/dev/null || echo -1)
  local ok=no
  case $expect in
    allow) [[ $code =~ ^2 ]] && { [ "$rows" != 0 ] || [ "$ret" = minimal ]; } && ok=yes ;;
    deny) { [[ ! $code =~ ^2 ]] || [ "$rows" = 0 ]; } && ok=yes ;;
    rows=*) [[ $code =~ ^2 ]] && [ "$rows" = "${expect#rows=}" ] && ok=yes ;;
  esac
  if [ $ok = yes ]; then pass=$((pass + 1)); else fail=$((fail + 1)); fi
  printf '%-4s %-9s %-52s expected %-8s got HTTP %s, %s rows\n' "$([ $ok = yes ] && echo ok || echo FAIL)" "$who" "$name" "$expect" "$code" "$rows"
}

echo "customer used for tests has $OWN orders; other customers have $OTHERS"

check "read products"                      allow    visitor GET "products?select=id&limit=5"
check "read active payment details"        allow    visitor GET "payment_gateways?select=upi_id"
check "read reviewer names"                allow    visitor GET "profiles?select=id,full_name&limit=5"
check "read reviewer emails"               deny     visitor GET "profiles?select=email&limit=5"
check "read orders"                        deny     visitor GET "orders?select=id&limit=5"
check "read customers"                     deny     visitor GET "customers?select=id&limit=5"
check "read subadmin passwords"            deny     visitor GET "subadmins?select=email,password"
check "read old users table"               deny     visitor GET "users?select=email,password"
check "read rakvih subadmins"              deny     visitor GET "rakvih_subadmins?select=email,password"
check "read contact messages"              deny     visitor GET "contact_messages?select=id"
check "read coupons"                       deny     visitor GET "coupons?select=code"
check "change a product price"             deny     visitor PATCH "product_variations?id=gt.0" '{"price":1}'
check "delete products"                    deny     visitor DELETE "products?id=gt.0"
check "change payment details"             deny     visitor PATCH "payment_gateways?id=not.is.null" '{"upi_id":"x"}'
check "add to cart without signing in"     deny     visitor POST "cart" "{\"product_id\":$PRODUCT,\"quantity\":1}"
check "send contact form"                  allow    visitor POST "contact_messages" '{"name":"t","email":"t@t","message":"t"}' minimal
check "read back contact messages"         deny     visitor POST "contact_messages" '{"name":"t","email":"t@t","message":"t"}'
check "count a video view"                 allow    visitor PATCH "videos?id=gt.0&limit=1&order=id" '{"views_count":1}'
check "read video like counts"             allow    visitor GET "videos?select=id,video_likes(id,user_id)&limit=3"
check "add a like without signing in"      deny     visitor POST "video_likes" '{"video_id":1}'
check "change a video title"               deny     visitor PATCH "videos?id=gt.0" '{"title":"x"}'
check "reduce stock"                       deny     visitor POST "rpc/decrement_product_stock" '{"items":[]}'

check "read own orders only"               "rows=$OWN" customer GET "orders?select=id,user_id"
check "read customers"                     deny     customer GET "customers?select=id"
check "read subadmins"                     deny     customer GET "subadmins?select=email"
check "read coupons at checkout"           allow    customer GET "coupons?select=code&limit=1"
ORDER="\"full_name\":\"t\",\"phone_number\":\"1\",\"house_number\":\"1\",\"street\":\"t\",\"city\":\"t\",\"state\":\"t\",\"pincode\":\"1\",\"payment_method\":\"Bank Transfer\",\"total_price\":1,\"shipping_cost\":0,\"grand_total\":1,\"cart_items\":[]"
check "place own order"                    allow    customer POST "orders" "{\"user_id\":\"$CUSTOMER\",$ORDER}"
check "place order as someone else"        deny     customer POST "orders" "{\"user_id\":\"00000000-0000-0000-0000-000000000000\",$ORDER}"
check "place order already marked paid"    deny     customer POST "orders" "{\"user_id\":\"$CUSTOMER\",$ORDER,\"payment_status\":\"paid\"}"
check "mark own order paid"                deny     customer PATCH "orders?user_id=eq.$CUSTOMER" '{"payment_status":"paid"}'
check "add to own cart"                    allow    customer POST "cart" "{\"user_id\":\"$CUSTOMER\",\"product_id\":$PRODUCT,\"quantity\":1}"
check "add to someone else's cart"         deny     customer POST "cart" "{\"user_id\":\"00000000-0000-0000-0000-000000000000\",\"product_id\":$PRODUCT,\"quantity\":1}"
check "change a product price"             deny     customer PATCH "product_variations?id=gt.0" '{"price":1}'
check "post own review"                    allow    customer POST "reviews" "{\"product_id\":$PRODUCT,\"user_id\":\"$CUSTOMER\",\"rating\":5,\"review_text\":\"t\"}"
check "reduce stock at checkout"           allow    customer POST "rpc/decrement_product_stock" '{"items":[]}'

check "read customers"                     allow    admin   GET "customers?select=id&limit=5"
check "read all orders"                    allow    admin   GET "orders?select=id&limit=5"
check "change a product price"             allow    admin   PATCH "product_variations?id=eq.$("${PSQL[@]}" -c 'select id from product_variations order by id limit 1')" '{"price":1}'
check "manage subadmins"                   allow    admin   GET "subadmins?select=email"
check "mark an order paid"                 allow    admin   PATCH "orders?id=eq.$("${PSQL[@]}" -c 'select id from orders order by order_date desc limit 1')" '{"payment_status":"paid"}'

code=$(curl -s -o /tmp/check.json -w '%{http_code}' -X POST -H "Authorization: Bearer $T_ADMIN" \
  -H 'Content-Type: application/json' -H 'Prefer: tx=rollback, return=representation' \
  -d '{"email":"check@example.com","password":"plain-text-pw"}' "$B/subadmins")
if [[ $code =~ ^2 ]] && grep -q '"password":"\$2' /tmp/check.json; then
  pass=$((pass + 1)); echo "ok   admin     new subadmin password is stored hashed"
else
  fail=$((fail + 1)); echo "FAIL admin     new subadmin password is stored hashed (HTTP $code)"
fi

echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
