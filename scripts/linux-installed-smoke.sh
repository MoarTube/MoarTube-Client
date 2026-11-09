#!/usr/bin/env bash
set -euo pipefail
cd /workspace
arch="$(node -p 'process.env.MOARTUBE_DESKTOP_ARCH || process.arch')"
variant="$(node -p 'process.env.MOARTUBE_DESKTOP_VARIANT || "client"')"
case "$arch" in x64|arm64) ;; *) exit 1 ;; esac
case "$variant" in
  client) prefix=MoarTube-Client; product='MoarTube Client'; package=moartube-client; executable=moartube-client-desktop ;;
  bundled) prefix=MoarTube-Client-Node; product='MoarTube Client + Node'; package=moartube-client-node; executable=moartube-client-node-desktop ;;
  *) exit 1 ;;
esac
target="linux-$arch"
reports="build/desktop/reports/$target"
mkdir -p "$reports"
printf '#!/bin/sh\nprintf "existing npm CLI\n"\n' > /tmp/moartube-cli-fixture
chmod 755 /tmp/moartube-cli-fixture
ln -s /tmp/moartube-cli-fixture /usr/bin/moartube-client
dpkg --install "$PWD"/"$prefix"-[0-9]*-"$target".deb
test "$(readlink /usr/bin/moartube-client)" = /tmp/moartube-cli-fixture
test -f "/usr/share/applications/$package.desktop"
grep -q "^StartupWMClass=$package$" "/usr/share/applications/$package.desktop"
test -s "/opt/$product/resources/MoarTube-LICENSE.md"
apparmor_parser --skip-kernel-load --skip-read-cache "/opt/$product/resources/apparmor-profile"
ldd "/opt/$product/$executable" > "$reports/electron-ldd.txt"
if grep -q 'not found' "$reports/electron-ldd.txt"; then exit 1; fi
dpkg-query -W > "$reports/runtime-packages.txt"
printf '{"private":true,"type":"module"}\n' > package.json
npm install --offline --ignore-scripts --no-audit --no-fund --save-exact @playwright/test@1.64.1
mkdir -p /home/desktop-test/.config /home/desktop-test/.cache /tmp/moartube-desktop-runtime
chmod 700 /tmp/moartube-desktop-runtime
chown desktop-test:desktop-test /tmp/moartube-desktop-runtime
backend_media="build/desktop/profiles/$target/backend-node/client/media/videos/install-preserve/keep.txt"
mkdir -p "$(dirname "$backend_media")"
printf 'preserve backend media\n' > "$backend_media"
chown -R desktop-test:desktop-test /workspace /home/desktop-test
runuser -u desktop-test -- env HOME=/home/desktop-test \
  "/opt/$product/resources/runtime/node" scripts/desktop-backend-probe.cjs "/opt/$product/resources"
cp "$reports/backend-probe.json" "$reports/installed-backend-probe.json"
chown root:root "/opt/$product/chrome-sandbox"
chmod 4755 "/opt/$product/chrome-sandbox"
run_gui() {
  if [ "$variant" = bundled ]; then
    runuser -u desktop-test -- env HOME=/home/desktop-test XDG_RUNTIME_DIR=/tmp/moartube-desktop-runtime \
      dbus-run-session -- xvfb-run -a bash scripts/linux-gui-smoke.sh scripts/desktop-bundled-smoke.mjs "$1"
    runuser -u desktop-test -- env HOME=/home/desktop-test XDG_RUNTIME_DIR=/tmp/moartube-desktop-runtime \
      dbus-run-session -- xvfb-run -a bash scripts/linux-gui-smoke.sh scripts/desktop-share-smoke.mjs "$1"
  else
    runuser -u desktop-test -- env HOME=/home/desktop-test XDG_RUNTIME_DIR=/tmp/moartube-desktop-runtime \
      dbus-run-session -- xvfb-run -a bash scripts/linux-gui-smoke.sh scripts/desktop-smoke.mjs "$1"
  fi
}
run_gui "/opt/$product/$executable"
if [ "$variant" = bundled ]; then report_mode=bundled-packaged; else report_mode=packaged; fi
cp "$reports/$report_mode/smoke.json" "$reports/installed-smoke.json"
portable='/workspace/portable QA Café 日本語'
mkdir -p "$portable"
tar -xzf ./"$prefix"-[0-9]*-"$target"-portable.tar.gz -C "$portable"
portable_exe="$(find "$portable" -type f -name "$executable" -print -quit)"
test -n "$portable_exe"
chown -R desktop-test:desktop-test "$portable"
chown root:root "$(dirname "$portable_exe")/chrome-sandbox"
chmod 4755 "$(dirname "$portable_exe")/chrome-sandbox"
runuser -u desktop-test -- env HOME=/home/desktop-test \
  "$(dirname "$portable_exe")/resources/runtime/node" scripts/desktop-backend-probe.cjs "$(dirname "$portable_exe")/resources"
cp "$reports/backend-probe.json" "$reports/portable-backend-probe.json"
run_gui "$portable_exe"
cp "$reports/$report_mode/smoke.json" "$reports/portable-smoke.json"
dpkg --install "$PWD"/"$prefix"-[0-9]*-"$target".deb
apt-get remove -y "$package"
test -f "build/desktop/profiles/$target/backend-node/client/_client_settings.json"
grep -q 'preserve backend media' "$backend_media"
if [ "$variant" = client ]; then
  test -f "build/desktop/profiles/$target/smoke-packaged/xdg/MoarTube/client/_client_settings.json"
fi
test ! -e "/opt/$product/$executable"
test "$(readlink /usr/bin/moartube-client)" = /tmp/moartube-cli-fixture
printf 'Install, backend, portable GUI, reinstall, uninstall and data preservation passed.\n' > "$reports/installation-result.txt"
printf 'Installed and portable graphical checks passed with Chromium sandbox enabled.\n' > "$reports/gui-result.txt"
