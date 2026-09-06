#!/bin/sh

set -eu

HELPER_DIR=${HELPER_DIR:-/usr/libexec}
POLKIT_DIR=${POLKIT_DIR:-/usr/share/polkit-1/actions}
HELPER_NAME=cato-vpn-route-helper
POLICY_NAME=com.github.kaleidoscopeit.catovpn-manager.policy

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
HELPER_SOURCE=$SCRIPT_DIR/$HELPER_NAME
POLICY_SOURCE=$SCRIPT_DIR/polkit/$POLICY_NAME

die() {
    echo "error: $*" >&2
    exit 1
}

need_command() {
    command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

[ "$(id -u)" -eq 0 ] || die "run this installer as root, for example: sudo ./install-helper.sh"
[ -f "$HELPER_SOURCE" ] || die "helper source not found: $HELPER_SOURCE"
[ -f "$POLICY_SOURCE" ] || die "Polkit policy not found: $POLICY_SOURCE"

need_command install
need_command pkexec
[ -x /usr/sbin/ip ] || die "missing required executable: /usr/sbin/ip"
[ -d "$POLKIT_DIR" ] || die "Polkit actions directory not found: $POLKIT_DIR"

install -D -o root -g root -m 0755 "$HELPER_SOURCE" "$HELPER_DIR/$HELPER_NAME"
install -D -o root -g root -m 0644 "$POLICY_SOURCE" "$POLKIT_DIR/$POLICY_NAME"

echo "Installed $HELPER_DIR/$HELPER_NAME"
echo "Installed $POLKIT_DIR/$POLICY_NAME"
echo "Restart the GNOME Shell extension to detect the helper."
