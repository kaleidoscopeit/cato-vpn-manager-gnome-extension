import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    classifyRoutes,
    normalizeDestination,
    parseCatoStatus,
    stripTerminalSequences,
} from './cato-state.js';

const CATO_SDP = '/usr/bin/cato-sdp';
const SYSTEMCTL = '/usr/bin/systemctl';
const IP = '/usr/sbin/ip';
const PKEXEC = '/usr/bin/pkexec';
const ROUTE_HELPER = '/usr/libexec/cato-vpn-route-helper';

const NETWORK_EVENT_DEBOUNCE_SECONDS = 3;
const STATUS_PROBE_COOLDOWN_SECONDS = 15;
const MENU_STATUS_MAX_AGE_SECONDS = 60;
const PANEL_ICON_MIN_SIZE = 16;
const PANEL_ICON_MAX_SIZE = 28;
const PANEL_ICON_HEIGHT_RATIO = 0.68;

const STATUS_ICONS = Object.freeze({
    serviceOff: 'icons/cato-status-service-off.svg',
    disconnected: 'icons/cato-status-disconnected.svg',
    connected: 'icons/cato-status-connected.svg',
    routingProfile: 'icons/cato-status-routing-profile.svg',
    routeWarning: 'icons/cato-status-route-warning.svg',
});

const SystemdManagerProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.freedesktop.systemd1.Manager">
    <method name="GetUnit">
      <arg type="s" direction="in"/>
      <arg type="o" direction="out"/>
    </method>
  </interface>
</node>`);

const SystemdUnitProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.freedesktop.systemd1.Unit">
    <property name="ActiveState" type="s" access="read"/>
  </interface>
</node>`);

function unpackProfiles(settings) {
    return settings.get_value('route-profiles').deepUnpack().map(profile => ({
        id: profile[0],
        name: profile[1],
        deleteRoutes: profile[2].map(normalizeDestination),
        addRoutes: profile[3].map(normalizeDestination),
    }));
}

function format(text, ...values) {
    let index = 0;
    return text.replace(/%s/g, () => values[index++]);
}

function runCommand(argv, timeoutSeconds = 15, cancellable = new Gio.Cancellable()) {
    return new Promise((resolve, reject) => {
        let process;
        try {
            process = Gio.Subprocess.new(
                argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (error) {
            reject(error);
            return;
        }

        let timedOut = false;
        let timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            timeoutSeconds,
            () => {
                timedOut = true;
                timeoutId = 0;
                cancellable.cancel();
                process.force_exit();
                return GLib.SOURCE_REMOVE;
            }
        );
        const cancelSignal = cancellable.connect(() => process.force_exit());

        process.communicate_utf8_async(null, cancellable, (source, result) => {
            if (timeoutId) {
                GLib.Source.remove(timeoutId);
                timeoutId = 0;
            }
            cancellable.disconnect(cancelSignal);

            try {
                const [, stdout, stderr] = source.communicate_utf8_finish(result);
                resolve({
                    successful: source.get_successful(),
                    stdout: stdout ?? '',
                    stderr: stderr ?? '',
                });
            } catch (error) {
                reject(timedOut ? new Error(_('Command timed out')) : error);
            }
        });
    });
}

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(extension, settings) {
        super._init(0, _('Cato VPN Manager'));

        this._extension = extension;
        this._settings = settings;
        this._destroyed = false;
        this._refreshInProgress = false;
        this._lastStatusProbe = 0;
        this._notifiedUpdateVersion = null;
        this._statusPopup = null;
        this._aboutPopup = null;
        this._clientUpdateItem = null;
        this._activeCommands = new Set();
        this._networkDebounceId = 0;
        this._networkMonitor = null;
        this._networkMonitorStream = null;
        this._networkMonitorCancellable = null;
        this._serviceProxy = null;
        this._serviceProxySignal = 0;
        this._settingsSignal = 0;
        this._menuSignal = 0;
        this._panelHeightSignal = 0;
        this._state = {
            serviceActive: false,
            catoState: 'STATE_UNKNOWN',
            tunDevice: null,
            rawStatus: '',
            routes: [],
            activeProfile: null,
            routeMode: 'unknown',
            installedVersion: null,
            availableVersion: null,
            updateAvailable: false,
        };

        this._helperPath = this._detectRouteHelper();
        this._profiles = unpackProfiles(this._settings);

        this._icon = new St.Icon({
            gicon: this._createStatusIcon(STATUS_ICONS.serviceOff),
            style_class: 'cato-panel-icon',
        });
        this.add_child(this._icon);
        this._panelHeightSignal = Main.panel.connect(
            'notify::height',
            () => this._syncIconSize()
        );
        this._syncIconSize();
        this._buildMenu();

        this._settingsSignal = this._settings.connect('changed', () => {
            this._profiles = unpackProfiles(this._settings);
            this._rebuildProfileMenu();
            this._classifyRoutes();
            this._updateUi();
        });

        this._menuSignal = this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (!isOpen)
                return;

            const age = (GLib.get_monotonic_time() - this._lastStatusProbe) /
                GLib.USEC_PER_SEC;
            if (age > MENU_STATUS_MAX_AGE_SECONDS)
                this._refreshAuthoritative(false);
        });

        this._startServiceMonitor();
        this._startNetworkMonitor();
        this._refreshAuthoritative(true);
    }

    _buildMenu() {
        this._statusItem = new PopupMenu.PopupMenuItem(_('Status: loading...'), {
            reactive: false,
        });
        this.menu.addMenuItem(this._statusItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const connectItem = new PopupMenu.PopupImageMenuItem(
            _('Connect'),
            'network-vpn-symbolic'
        );
        connectItem.connect('activate', () => this._startCato(false));
        this.menu.addMenuItem(connectItem);

        const reauthItem = new PopupMenu.PopupImageMenuItem(
            _('Connect with new authentication'),
            'dialog-password-symbolic'
        );
        reauthItem.connect('activate', () => this._startCato(true));
        this.menu.addMenuItem(reauthItem);

        const disconnectItem = new PopupMenu.PopupImageMenuItem(
            _('Disconnect'),
            'network-vpn-disconnected-symbolic'
        );
        disconnectItem.connect('activate', () => this._runAction(
            [CATO_SDP, 'stop'],
            _('Cato disconnection failed')
        ));
        this.menu.addMenuItem(disconnectItem);

        this._clientUpdateItem = new PopupMenu.PopupImageMenuItem(
            _('Update Cato client'),
            'software-update-available-symbolic'
        );
        this._clientUpdateItem.visible = false;
        this._clientUpdateItem.connect('activate', () => this._updateCatoClient());
        this.menu.addMenuItem(this._clientUpdateItem);

        if (this._helperPath) {
            this._profilesMenu = new PopupMenu.PopupSubMenuMenuItem(
                _('Routing profiles'),
                true
            );
            this.menu.addMenuItem(this._profilesMenu);
            this._rebuildProfileMenu();
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        const serviceActions = [
            [_('Start service'), 'media-playback-start-symbolic', 'start'],
            [_('Stop service'), 'process-stop-symbolic', 'stop'],
            [_('Restart service'), 'view-refresh-symbolic', 'restart'],
        ];
        for (const [label, icon, action] of serviceActions) {
            const item = new PopupMenu.PopupImageMenuItem(label, icon);
            item.connect('activate', () => this._runAction(
                [SYSTEMCTL, action, 'cato-client.service'],
                format(_('Service operation failed: %s'), action)
            ));
            this.menu.addMenuItem(item);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const detailsItem = new PopupMenu.PopupImageMenuItem(
            _('Cato status details'),
            'dialog-information-symbolic'
        );
        detailsItem.connect('activate', () => this._openStatusPopup());
        this.menu.addMenuItem(detailsItem);

        const refreshItem = new PopupMenu.PopupImageMenuItem(
            _('Refresh status'),
            'view-refresh-symbolic'
        );
        refreshItem.connect('activate', () => this._refreshAuthoritative(true));
        this.menu.addMenuItem(refreshItem);

        const preferencesItem = new PopupMenu.PopupImageMenuItem(
            _('Preferences'),
            'emblem-system-symbolic'
        );
        preferencesItem.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(preferencesItem);

        const aboutItem = new PopupMenu.PopupImageMenuItem(
            _('About and help'),
            'help-about-symbolic'
        );
        aboutItem.connect('activate', () => this._openAboutPopup());
        this.menu.addMenuItem(aboutItem);
    }

    _rebuildProfileMenu() {
        if (!this._profilesMenu)
            return;

        this._profilesMenu.menu.removeAll();

        if (this._profiles.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem(_('No routing profile configured'));
            emptyItem.setSensitive(false);
            this._profilesMenu.menu.addMenuItem(emptyItem);
            return;
        }

        for (const profile of this._profiles) {
            const item = new PopupMenu.PopupMenuItem(profile.name);
            item.connect('activate', () => this._applyProfile(profile));
            this._profilesMenu.menu.addMenuItem(item);
        }
    }

    _runCommand(argv, timeoutSeconds = 15) {
        const cancellable = new Gio.Cancellable();
        this._activeCommands.add(cancellable);
        return runCommand(argv, timeoutSeconds, cancellable).finally(() => {
            this._activeCommands.delete(cancellable);
        });
    }

    _detectRouteHelper() {
        try {
            const file = Gio.File.new_for_path(ROUTE_HELPER);
            const info = file.query_info(
                'access::can-execute,unix::uid,unix::mode',
                Gio.FileQueryInfoFlags.NONE,
                null
            );
            const owner = info.get_attribute_uint32('unix::uid');
            const mode = info.get_attribute_uint32('unix::mode');
            const securePermissions = (mode & 0o022) === 0;
            return info.get_attribute_boolean('access::can-execute') &&
                owner === 0 && securePermissions
                ? ROUTE_HELPER
                : null;
        } catch (_error) {
            return null;
        }
    }

    _startCato(resetCredentials) {
        const argv = [CATO_SDP, 'start', '--no-office-mode'];
        if (resetCredentials)
            argv.push('--reset-cred');

        try {
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
            this._scheduleStatusProbe(3, true);
        } catch (error) {
            Main.notifyError(_('Cato VPN Manager'), error.message);
        }
    }

    async _runAction(argv, errorTitle) {
        try {
            const result = await this._runCommand(argv, 30);
            if (!result.successful) {
                const message = result.stderr.trim() || result.stdout.trim() || _('Unknown error');
                Main.notifyError(errorTitle, message);
            }
        } catch (error) {
            Main.notifyError(errorTitle, error.message);
        } finally {
            this._scheduleStatusProbe(2, true);
        }
    }

    async _applyProfile(profile) {
        if (!this._helperPath)
            return;

        if (this._state.catoState !== 'STATE_AUTHENTICATED' || !this._state.tunDevice) {
            await this._refreshAuthoritative(true);
            if (this._state.catoState !== 'STATE_AUTHENTICATED' || !this._state.tunDevice) {
                Main.notifyError(
                    _('Routing profile not applied'),
                    _('Cato does not appear authenticated or the VPN interface is unavailable.')
                );
                return;
            }
        }

        const argv = [
            PKEXEC,
            this._helperPath,
            'apply',
            '--interface',
            this._state.tunDevice,
        ];
        for (const route of profile.deleteRoutes)
            argv.push('--delete', route);
        for (const route of profile.addRoutes)
            argv.push('--add', route);

        try {
            const result = await this._runCommand(argv, 120);
            if (!result.successful) {
                const message = result.stderr.trim() || result.stdout.trim() || _('Helper exited with an error');
                Main.notifyError(_('Routing profile not applied'), message);
                return;
            }

            await this._refreshRoutes();
            this._updateUi();
        } catch (error) {
            Main.notifyError(_('Routing profile not applied'), error.message);
        }
    }

    async _refreshService() {
        if (this._serviceProxy) {
            this._setServiceActive(this._serviceProxy.ActiveState === 'active');
            return;
        }

        try {
            const result = await this._runCommand(
                [SYSTEMCTL, 'is-active', 'cato-client.service'],
                5
            );
            this._setServiceActive(result.successful && result.stdout.trim() === 'active');
        } catch (_error) {
            this._setServiceActive(false);
            this._state.catoState = 'STATE_UNKNOWN';
        }
    }

    _setServiceActive(active) {
        this._state.serviceActive = active;
        if (!active) {
            this._state.catoState = 'STATE_STOPPED';
            this._state.tunDevice = null;
            this._state.rawStatus = _('Cato service is stopped; status was not queried.');
            this._state.routes = [];
            this._state.routeMode = 'unknown';
            this._state.activeProfile = null;
            this._state.installedVersion = null;
            this._state.availableVersion = null;
            this._state.updateAvailable = false;
            this._statusPopup?.setOutput(this._state.rawStatus);
        }
    }

    async _refreshRoutes() {
        if (this._state.catoState !== 'STATE_AUTHENTICATED' || !this._state.tunDevice) {
            this._state.routes = [];
            this._classifyRoutes();
            return;
        }

        try {
            const result = await this._runCommand([IP, '-j', 'route', 'show', 'table', 'main'], 5);
            this._state.routes = result.successful ? JSON.parse(result.stdout) : [];
        } catch (_error) {
            this._state.routes = [];
        }
        this._classifyRoutes();
    }

    _classifyRoutes() {
        this._state.activeProfile = null;
        this._state.routeMode = 'unknown';

        if (this._state.catoState !== 'STATE_AUTHENTICATED' || !this._state.tunDevice)
            return;

        const classification = classifyRoutes(
            this._state.routes,
            this._state.tunDevice,
            this._profiles
        );
        this._state.routeMode = classification.mode;
        this._state.activeProfile = classification.activeProfile;
    }

    async _refreshAuthoritative(force = false) {
        if (this._destroyed || this._refreshInProgress)
            return this._state.rawStatus;

        const now = GLib.get_monotonic_time();
        const elapsed = (now - this._lastStatusProbe) / GLib.USEC_PER_SEC;
        if (!force && elapsed < STATUS_PROBE_COOLDOWN_SECONDS)
            return this._state.rawStatus;

        this._refreshInProgress = true;
        this._lastStatusProbe = now;
        try {
            await this._refreshService();
            if (!this._state.serviceActive) {
                this._updateUi();
                return this._state.rawStatus;
            }

            const result = await this._runCommand([CATO_SDP, 'status'], 15);
            const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
            const cleanedOutput = stripTerminalSequences(output).trimEnd();
            this._state.rawStatus = cleanedOutput;

            if (result.successful || output) {
                const parsed = parseCatoStatus(cleanedOutput);
                this._state.catoState = parsed.state;
                this._state.tunDevice = parsed.tunDevice;
                this._state.installedVersion = parsed.installedVersion;
                this._state.availableVersion = parsed.availableVersion;
                this._state.updateAvailable = parsed.updateAvailable;
            } else {
                this._state.catoState = 'STATE_UNKNOWN';
                this._state.tunDevice = null;
                this._state.installedVersion = null;
                this._state.availableVersion = null;
                this._state.updateAvailable = false;
            }

            await this._refreshRoutes();
            this._notifyClientUpdateIfNeeded();
            this._statusPopup?.setOutput(this._state.rawStatus);
            this._updateUi();
            return this._state.rawStatus;
        } catch (error) {
            const message = format(_('Unable to read Cato status: %s'), error.message);
            this._state.rawStatus = message;
            this._state.catoState = 'STATE_UNKNOWN';
            this._statusPopup?.setOutput(message);
            this._updateUi();
            return message;
        } finally {
            this._refreshInProgress = false;
        }
    }

    _startServiceMonitor() {
        new SystemdManagerProxy(
            Gio.DBus.system,
            'org.freedesktop.systemd1',
            '/org/freedesktop/systemd1',
            (manager, error) => {
                if (error || this._destroyed)
                    return;

                manager.GetUnitRemote('cato-client.service', (result, getUnitError) => {
                    if (getUnitError || this._destroyed)
                        return;

                    const [unitPath] = result;
                    new SystemdUnitProxy(
                        Gio.DBus.system,
                        'org.freedesktop.systemd1',
                        unitPath,
                        (unit, unitError) => {
                            if (unitError || this._destroyed)
                                return;

                            this._serviceProxy = unit;
                            this._serviceProxySignal = unit.connect(
                                'g-properties-changed',
                                () => {
                                    const wasActive = this._state.serviceActive;
                                    this._setServiceActive(unit.ActiveState === 'active');
                                    if (this._state.serviceActive && !wasActive)
                                        this._scheduleStatusProbe(2, true);
                                    this._updateUi();
                                }
                            );
                            this._setServiceActive(unit.ActiveState === 'active');
                            this._updateUi();
                        }
                    );
                });
            }
        );
    }

    _startNetworkMonitor() {
        try {
            this._networkMonitor = Gio.Subprocess.new(
                [IP, 'monitor', 'link', 'route'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            this._networkMonitorCancellable = new Gio.Cancellable();
            this._networkMonitorStream = new Gio.DataInputStream({
                base_stream: this._networkMonitor.get_stdout_pipe(),
            });
            this._readNetworkEvent();
        } catch (error) {
            console.warn(`CatoVPN: network event monitoring unavailable: ${error.message}`);
        }
    }

    _readNetworkEvent() {
        if (this._destroyed || !this._networkMonitorStream)
            return;

        this._networkMonitorStream.read_line_async(
            GLib.PRIORITY_DEFAULT,
            this._networkMonitorCancellable,
            (stream, result) => {
                try {
                    const [line] = stream.read_line_finish(result);
                    if (line !== null) {
                        this._scheduleStatusProbe(NETWORK_EVENT_DEBOUNCE_SECONDS, false);
                        this._readNetworkEvent();
                    }
                } catch (error) {
                    if (!this._destroyed)
                        console.warn(`CatoVPN: network monitor error: ${error.message}`);
                }
            }
        );
    }

    _scheduleStatusProbe(delaySeconds, force) {
        if (this._destroyed)
            return;

        if (this._networkDebounceId)
            GLib.Source.remove(this._networkDebounceId);

        if (!force) {
            const elapsed = (GLib.get_monotonic_time() - this._lastStatusProbe) /
                GLib.USEC_PER_SEC;
            const cooldownRemaining = Math.ceil(STATUS_PROBE_COOLDOWN_SECONDS - elapsed);
            delaySeconds = Math.max(delaySeconds, cooldownRemaining);
        }

        this._networkDebounceId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            delaySeconds,
            () => {
                this._networkDebounceId = 0;
                this._refreshAuthoritative(force);
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _updateUi() {
        if (this._destroyed)
            return;

        let iconName;
        let statusText;
        if (!this._state.serviceActive) {
            iconName = STATUS_ICONS.serviceOff;
            statusText = _('Cato service stopped');
        } else if (this._state.catoState !== 'STATE_AUTHENTICATED') {
            iconName = STATUS_ICONS.disconnected;
            statusText = this._state.catoState === 'STATE_CONNECTED_UNAUTH'
                ? _('Cato is waiting for authentication')
                : _('Cato disconnected');
        } else if (this._state.routeMode === 'full') {
            iconName = STATUS_ICONS.connected;
            statusText = _('Cato connected');
        } else if (this._state.routeMode === 'profile') {
            iconName = STATUS_ICONS.routingProfile;
            statusText = _('Cato connected');
        } else {
            iconName = STATUS_ICONS.routeWarning;
            statusText = _('Cato connected');
        }

        this._icon.gicon = this._createStatusIcon(iconName);
        this._syncIconSize();
        this._statusItem.label.text = format(_('Status: %s'), statusText);

        if (this._clientUpdateItem) {
            this._clientUpdateItem.visible = this._state.updateAvailable;
            if (this._state.availableVersion) {
                this._clientUpdateItem.label.text =
                    format(_('Update Cato client: %s'), this._state.availableVersion);
            } else {
                this._clientUpdateItem.label.text = _('Update Cato client');
            }
        }

    }

    _createStatusIcon(relativePath) {
        return Gio.FileIcon.new(Gio.File.new_for_path(
            GLib.build_filenamev([this._extension.path, relativePath])
        ));
    }

    _syncIconSize() {
        const panelHeight = Main.panel?.height || 0;
        const availableSize = panelHeight > 0
            ? Math.round(panelHeight * PANEL_ICON_HEIGHT_RATIO)
            : PANEL_ICON_MIN_SIZE;
        const iconSize = Math.min(
            PANEL_ICON_MAX_SIZE,
            Math.max(PANEL_ICON_MIN_SIZE, availableSize)
        );
        this._icon.icon_size = iconSize;
    }

    _notifyClientUpdateIfNeeded() {
        const availableVersion = this._state.availableVersion;
        if (!this._state.updateAvailable || !availableVersion) {
            this._notifiedUpdateVersion = null;
            return;
        }

        if (this._notifiedUpdateVersion === availableVersion)
            return;

        const installedText = this._state.installedVersion
            ? format(_('Installed version: %s. '), this._state.installedVersion)
            : '';
        Main.notify(
            _('Cato update available'),
            installedText +
                format(_('New version: %s. Open the extension menu to start the update.'), availableVersion)
        );
        this._notifiedUpdateVersion = availableVersion;
    }

    async _updateCatoClient() {
        const version = this._state.availableVersion;
        try {
            const result = await this._runCommand([CATO_SDP, 'update'], 300);
            if (!result.successful) {
                const message = result.stderr.trim() || result.stdout.trim() || _('Update failed');
                Main.notifyError(_('Cato update failed'), message);
                return;
            }

            Main.notify(
                _('Cato update completed'),
                version
                    ? format(_('Update to version %s completed.'), version)
                    : _('Update completed.')
            );
        } catch (error) {
            Main.notifyError(_('Cato update failed'), error.message);
        } finally {
            this._scheduleStatusProbe(2, true);
        }
    }

    async _openStatusPopup() {
        try {
            const {StatusPopup} = await import('./status-popup.js');
            if (this._destroyed)
                return;

            this._statusPopup = new StatusPopup({
                initialOutput: this._state.rawStatus,
                refresh: () => this._refreshAuthoritative(true),
                onClosed: () => {
                    this._statusPopup = null;
                },
            });
            this._statusPopup.open();

            const age = (GLib.get_monotonic_time() - this._lastStatusProbe) /
                GLib.USEC_PER_SEC;
            if (!this._state.rawStatus || age > 5)
                this._statusPopup.refresh();
        } catch (error) {
            Main.notifyError(_('Cato VPN Manager'), error.message);
        }
    }

    async _openAboutPopup() {
        try {
            if (this._aboutPopup)
                return;

            const {AboutPopup} = await import('./about-popup.js');
            if (!this._destroyed)
                this._aboutPopup = new AboutPopup(
                    this._extension.path,
                    () => this._aboutPopup = null
                );
            this._aboutPopup?.open();
        } catch (error) {
            Main.notifyError(_('Cato VPN Manager'), error.message);
        }
    }

    destroy() {
        this._destroyed = true;

        if (this._networkDebounceId)
            GLib.Source.remove(this._networkDebounceId);
        if (this._settingsSignal)
            this._settings.disconnect(this._settingsSignal);
        if (this._menuSignal)
            this.menu.disconnect(this._menuSignal);
        if (this._panelHeightSignal)
            Main.panel.disconnect(this._panelHeightSignal);
        if (this._serviceProxySignal)
            this._serviceProxy.disconnect(this._serviceProxySignal);

        this._networkMonitorCancellable?.cancel();
        this._networkMonitor?.force_exit();
        for (const cancellable of this._activeCommands)
            cancellable.cancel();
        this._activeCommands.clear();
        this._statusPopup?.close();
        this._aboutPopup?.close();

        this._networkMonitorStream = null;
        this._networkMonitor = null;
        this._serviceProxy = null;
        this._statusPopup = null;
        this._aboutPopup = null;
        super.destroy();
    }
});

export default class CatoVPNExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new Indicator(this, this._settings);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
