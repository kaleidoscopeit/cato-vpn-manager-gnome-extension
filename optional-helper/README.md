# Optional route helper

The extension does not require this component to control Cato or read status.
It is installed separately and is never included in the extension ZIP.

Install after reviewing the helper and policy:

```sh
cd optional-helper
sudo ./install-helper.sh
```

The helper accepts IPv4 destinations for table `main`, validates its inputs and
serializes applications with a lock in `/run`. It saves native route dumps for
requested removals before making changes. On command failure or a handled
HUP/INT/TERM signal it removes additions it made and restores saved routes.
If restoration itself fails, it retains the recovery directory under `/run` and
reports its path. Inspect the live interface and route state before manually
using `ip -4 route restore` on those dumps.

This is best-effort recovery: power loss, SIGKILL, interface removal and
changes by other network managers can prevent a complete rollback.
