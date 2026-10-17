#!/bin/sh
set -eu
HELPER_DIR=${HELPER_DIR:-/usr/libexec}
POLKIT_DIR=${POLKIT_DIR:-/usr/share/polkit-1/actions}
HELPER_NAME=cato-vpn-route-helper
POLICY_NAME=com.github.kaleidoscopeit.catovpn-manager.policy
[ "$(id -u)" -eq 0 ] || { echo "run this uninstaller as root" >&2; exit 1; }
rm -f "$HELPER_DIR/$HELPER_NAME"
rm -f "$POLKIT_DIR/$POLICY_NAME"
echo "Removed $HELPER_DIR/$HELPER_NAME"
echo "Removed $POLKIT_DIR/$POLICY_NAME"
