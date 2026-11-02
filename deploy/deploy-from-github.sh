#!/bin/bash
# Updates the site to the latest code on GitHub's main branch. GitHub Actions starts it over SSH
# with a key that can run only this script (forced command in /root/.ssh/authorized_keys), so a
# leaked Actions secret can do nothing except redeploy what is already on GitHub.
#
# Pulls with the VPS's read-only deploy key, builds a new image, and only switches to it if the
# build succeeds. If the new version does not answer, it goes back to the previous image.
set -euo pipefail
cd /opt/bangalorecollective

exec 9>.deploy.lock
flock -n 9 || { echo "Another deploy is running; try again shortly."; exit 1; }

REPO=git@github.com:bangalorecollective/bangalorecollective-new.git
if [ ! -d repo/.git ]; then
  git clone --quiet --branch main "$REPO" repo
fi
git -C repo fetch --quiet origin main
git -C repo reset --hard --quiet origin/main
echo "Deploying $(git -C repo log -1 --format='%h %s')"

rsync -a --delete --exclude-from=repo/.dockerignore --exclude=.git repo/ app-src/

# Keep the running version so it can be restored.
docker image inspect bangalorecollective-app >/dev/null 2>&1 && docker tag bangalorecollective-app bangalorecollective-app:previous

if ! ./build-app.sh > build.log 2>&1; then
  tail -30 build.log
  echo "Build failed. The site is still running the previous version."
  exit 1
fi

healthy=no
for _ in $(seq 1 30); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/userinterface/home/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" 2>/dev/null; then
    healthy=yes
    break
  fi
  sleep 2
done

if [ "$healthy" != yes ]; then
  docker tag bangalorecollective-app:previous bangalorecollective-app
  docker compose up -d app >/dev/null 2>&1
  echo "The new version did not start properly, so the previous version was restored."
  exit 1
fi

echo "Deployed. The site is running $(git -C repo log -1 --format='%h')."
