import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function getDialogSize(maxWidth, maxHeight) {
    const monitor = Main.layoutManager.monitors[global.display.get_current_monitor()] ??
        Main.layoutManager.primaryMonitor ?? {width: 1024, height: 768};
    return {
        width: Math.min(maxWidth, Math.max(200, monitor.width - 160)),
        height: Math.min(maxHeight, Math.max(150, monitor.height - 300)),
    };
}
