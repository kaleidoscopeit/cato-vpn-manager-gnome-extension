#!/bin/sh

set -eu

HELPER_DIR=${HELPER_DIR:-/usr/libexec}
POLKIT_DIR=${POLKIT_DIR:-/usr/share/polkit-1/actions}
HELPER_NAME=cato-vpn-route-helper
POLICY_NAME=com.github.kaleidoscopeit.catovpn-manager.policy

die() {
    echo "error: $*" >&2
    exit 1
}

[ "$(id -u)" -eq 0 ] || die "run this uninstaller as root, for example: sudo ./uninstall-helper.sh"

rm -f "$HELPER_DIR/$HELPER_NAME"
rm -f "$POLKIT_DIR/$POLICY_NAME"

echo "Removed $HELPER_DIR/$HELPER_NAME"
echo "Removed $POLKIT_DIR/$POLICY_NAME"
echo "Restart the GNOME Shell extension to refresh helper availability."
