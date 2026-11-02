#!/bin/bash
# Builds the website image from ./app-src and restarts the app. Run on the VPS from
# /opt/bangalorecollective after copying new source into app-src.
#
# The home page is pre-rendered from the database during the build, so the build uses the VPS's
# own network to reach PostgREST on 127.0.0.1:3001 (docker compose cannot grant that).
set -euo pipefail
cd "$(dirname "$0")"

docker buildx build --load --allow network.host --network host \
  --build-arg POSTGREST_URL=http://127.0.0.1:3001 \
  -t bangalorecollective-app ./app-src

docker compose up -d app
