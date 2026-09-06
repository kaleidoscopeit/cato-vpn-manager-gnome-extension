# CATO VPN Manager

Control the Linux Cato SDP client from GNOME Shell and inspect its current
connection state.

## Status

- gray: Cato service stopped;
- red: service active, Cato not connected or waiting for authentication;
- green: Cato connected;
- blue: Cato connected with a matching routing profile;
- yellow: Cato connected, but routes are partial, ambiguous or not recognized.

## Menu Actions

- `Connect` starts the Cato client.
- `Connect with new authentication` starts Cato and requests a fresh login.
- `Disconnect` stops the VPN connection.
- `Cato status details` shows the latest `cato-sdp status` output.
- `Refresh status` requests a new status check.

## Routing Profiles

Routing profiles are intended for debugging, troubleshooting and advanced
administration. They describe an expected route configuration and are applied
only when explicitly selected from the menu.

Applying profiles requires the optional helper. Without it, the extension can
still recognize configured profiles from the current route table.

## Privacy

`cato-sdp status` may include account names, email addresses and IP addresses.
The extension keeps that output in memory and does not write it to disk.
