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

# Rewrite whatever the line currently holds rather than substituting the
# placeholder, because by the time this runs the placeholder may already be
# gone and the difference is invisible: a stamped value was once committed
# back into web/sw.js (2f578ba), and `postinstall` runs this build before the
# build command runs it again. A placeholder-only substitution is a silent
# no-op in both cases, so every release ships one cache name and a phone that
# installed the app keeps serving that release forever. Assigning the line
# unconditionally is correct however many times it runs.
sed -i.bak -E "s|^const BUILD_ID = '[^']*';|const BUILD_ID = '${BUILD_ID}';|" web/sw.js
rm -f web/sw.js.bak

grep -n "const BUILD_ID" web/sw.js

# The line must exist and must now hold this build's id — anything else means
# the assignment was reshaped and the stamp missed. Fail rather than ship an
# app that can never update itself.
if ! grep -q "^const BUILD_ID = '${BUILD_ID}';" web/sw.js; then
  echo "error: web/sw.js was not stamped with ${BUILD_ID}" >&2
  exit 1
fi
