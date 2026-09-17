#!/usr/bin/env bash
# 打包並把 dist/ 推到 gh-pages 分支（GitHub Pages 從這個分支提供網站）
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build
touch dist/.nojekyll

REMOTE=$(git remote get-url origin)
MSG="deploy: $(git rev-parse --short HEAD) $(date '+%Y-%m-%d %H:%M')"

cd dist
rm -rf .git
git init -q -b gh-pages
git add -A
git commit -q -m "$MSG"
git push -f "$REMOTE" gh-pages
rm -rf .git
echo "已部署：https://nightzhe.github.io/GoodMarket/"
