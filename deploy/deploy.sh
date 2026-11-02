#!/bin/bash
# Puts the code from this folder on the VPS. Run on the Mac from the project folder:
#
#   ./deploy/deploy.sh
#
# Checks the code compiles, copies it to the VPS (without secrets, uploads or node_modules,
# see .dockerignore), rebuilds the site there and restarts it. Takes about 2 minutes; the site
# is unavailable for a few seconds at the end.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY="$HOME/.ssh/bangalorecollective_vps"
HOST=root@201.18.206.138
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes)

echo "Checking the code..."
npx tsc --noEmit -p .

echo "Copying to the VPS..."
rsync -a --delete --exclude-from=.dockerignore --exclude=.git -e "${SSH[*]}" ./ "$HOST:/opt/bangalorecollective/app-src/"

echo "Building and restarting on the VPS..."
"${SSH[@]}" "$HOST" "cd /opt/bangalorecollective && ./build-app.sh > build.log 2>&1 || { tail -30 build.log; exit 1; }"

echo "Done."
