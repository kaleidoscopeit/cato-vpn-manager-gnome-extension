# Changelog

## 1.0.0 - 2026-09-06

- replace the five-second `cato-sdp status` polling with event-driven probes;
- add gettext-based internationalization with Italian translation catalog;
- keep the public README in English and load dedicated localized help content in the about dialog;
- detect the Cato interface from `tun device`;
- add GSettings-backed routing profiles and a preferences editor;
- add full status output and refresh actions;
- detect Cato client updates and expose a manual update action;
- size Shell status and help dialogs against the active monitor;
- wrap dialog content in scrollable containers compatible with GNOME Shell;
- add end padding to the help dialog so the final README lines remain visible;
- render fenced and inline code blocks correctly in the help dialog;
- scale the panel status icon conservatively against the actual GNOME Shell panel height;
- add scalable, low-gloss SVG status icons for all connection and routing states;
- add route-state classification for connected, routing profile and warning states;
- hide profile-application menu items when the optional helper is unavailable;
- remove saved profile selection; routing profiles are chosen from the indicator menu;
- simplify extension metadata and move maintainer credits to the README;
- add dedicated install and uninstall scripts for the optional route helper;
- move privileged route changes to a separately installed optional helper;
- remove SUID setup, temporary status files and shell command construction;
- add reproducible packaging, validation and project documentation.
