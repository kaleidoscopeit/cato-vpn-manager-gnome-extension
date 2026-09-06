# Optional route helper

The extension does not require this component for Cato connection and status
monitoring. The helper only enables applying routing profiles for debugging,
troubleshooting and advanced administration scenarios.

This helper is optional and is not part of the ZIP uploaded to
extensions.gnome.org.

## Install

Review the helper and policy, then run:

```sh
cd optional-helper
sudo ./install-helper.sh
```

The extension detects the root-owned executable at
`/usr/libexec/cato-vpn-route-helper` when it starts. Disable and enable the
extension after installing or removing it.

The Makefile provides the same install target for packagers or advanced users:

```sh
sudo make install
```

## Remove

```sh
cd optional-helper
sudo ./uninstall-helper.sh
```

The equivalent Makefile target is:

```sh
sudo make uninstall
```
