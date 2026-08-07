#!/bin/sh
# Stamp the deploying commit into the service worker.
#
# sw.js ships with a literal __BUILD_ID__ placeholder. If it were deployed
# as-is the cache name would never change, so a device that installed the app
# once would keep serving that release forever, no matter what we publish.
#
# WORKERS_CI_COMMIT_SHA is set by Workers Builds, CF_PAGES_COMMIT_SHA by Pages;
# the date fallback keeps local runs working.
set -e

BUILD_ID=$(echo "${WORKERS_CI_COMMIT_SHA:-${CF_PAGES_COMMIT_SHA:-dev-$(date +%Y%m%d%H%M%S)}}" | cut -c1-12)

sed -i.bak "s/__BUILD_ID__/${BUILD_ID}/" web/sw.js
rm -f web/sw.js.bak

grep -n "const BUILD_ID" web/sw.js

# A placeholder left behind means the substitution silently missed — fail the
# deploy rather than shipping an app that can never update itself.
if grep -q "__BUILD_ID__" web/sw.js; then
  echo "error: __BUILD_ID__ still present in web/sw.js" >&2
  exit 1
fi
