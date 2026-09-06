import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PROFILE_TYPE = 'a(ssasas)';
const ROUTE_HELPER = '/usr/libexec/cato-vpn-route-helper';

function unpackProfiles(settings) {
    return settings.get_value('route-profiles').deepUnpack().map(profile => ({
        id: profile[0],
        name: profile[1],
        deleteRoutes: profile[2],
        addRoutes: profile[3],
    }));
}

function saveProfiles(settings, profiles) {
    const tuples = profiles.map(profile => [
        profile.id,
        profile.name,
        profile.deleteRoutes,
        profile.addRoutes,
    ]);
    settings.set_value('route-profiles', new GLib.Variant(PROFILE_TYPE, tuples));
}

function parseRoutes(text) {
    return [...new Set(text
        .split(/[,\n]/)
        .map(route => route.trim())
        .filter(Boolean)
        .map(route => route === '0.0.0.0/0' ? 'default' : route))];
}

function isValidDestination(destination) {
    if (destination === 'default')
        return true;

    const [address, prefixText] = destination.split('/');
    if (destination.split('/').length > 2)
        return false;

    const octets = address.split('.');
    if (octets.length !== 4 || octets.some(octet =>
        !/^\d{1,3}$/.test(octet) || Number(octet) > 255))
        return false;

    return prefixText === undefined ||
        (/^\d{1,2}$/.test(prefixText) && Number(prefixText) <= 32);
}

function sameRoutes(first, second) {
    return [...first].sort().join('\n') === [...second].sort().join('\n');
}

function format(text, ...values) {
    let index = 0;
    return text.replace(/%s/g, () => values[index++]);
}

export default class CatoVpnPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._window = window;
        this._settings = this.getSettings();
        this._rows = [];

        window.set_default_size(680, 620);

        const page = new Adw.PreferencesPage({
            title: _('Routing profiles'),
            icon_name: 'network-vpn-symbolic',
        });
        window.add(page);

        const helperAvailable = this._isRouteHelperAvailable();
        const helperGroup = new Adw.PreferencesGroup({
            title: _('Optional helper'),
        });
        page.add(helperGroup);
        const helperRow = new Adw.ActionRow({
            title: helperAvailable ? _('Helper detected') : _('Helper not installed'),
            subtitle: helperAvailable
                ? _('Routing profiles can be applied from the extension menu.')
                : _('Routing profiles can be configured and recognized, but not applied.'),
        });
        helperRow.add_prefix(new Gtk.Image({
            icon_name: helperAvailable ? 'security-high-symbolic' : 'dialog-warning-symbolic',
        }));
        helperGroup.add(helperRow);

        this._profilesGroup = new Adw.PreferencesGroup({
            title: _('Routing profiles'),
            description: helperAvailable
                ? _('Define expected route configurations for troubleshooting and advanced administration.')
                : _('Define expected route configurations for troubleshooting and advanced administration. Install the optional helper to apply them from the menu.'),
        });
        page.add(this._profilesGroup);

        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Add routing profile'),
        });
        addButton.add_css_class('flat');
        addButton.connect('clicked', () => this._openProfileEditor(null));
        this._profilesGroup.set_header_suffix(addButton);

        this._settingsSignal = this._settings.connect(
            'changed::route-profiles',
            () => this._rebuildProfiles()
        );
        window.connect('close-request', () => {
            if (this._settingsSignal)
                this._settings.disconnect(this._settingsSignal);
            this._settingsSignal = 0;
        });

        this._rebuildProfiles();
    }

    _isRouteHelperAvailable() {
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
                owner === 0 && securePermissions;
        } catch (_error) {
            return false;
        }
    }

    _rebuildProfiles() {
        for (const row of this._rows)
            this._profilesGroup.remove(row);
        this._rows = [];

        const profiles = unpackProfiles(this._settings);
        if (profiles.length === 0) {
            const row = new Adw.ActionRow({
                title: _('No routing profile configured'),
                subtitle: _('Add a routing profile to describe an expected route configuration.'),
            });
            row.set_sensitive(false);
            this._profilesGroup.add(row);
            this._rows.push(row);
            return;
        }

        for (const profile of profiles) {
            const row = new Adw.ActionRow({
                title: profile.name,
                subtitle: format(_('Added routes: %s - removed routes: %s'), profile.addRoutes.length, profile.deleteRoutes.length),
            });

            const editButton = new Gtk.Button({
                icon_name: 'document-edit-symbolic',
                valign: Gtk.Align.CENTER,
                tooltip_text: _('Edit routing profile'),
            });
            editButton.add_css_class('flat');
            editButton.connect('clicked', () => this._openProfileEditor(profile));
            row.add_suffix(editButton);

            const deleteButton = new Gtk.Button({
                icon_name: 'edit-delete-symbolic',
                valign: Gtk.Align.CENTER,
                tooltip_text: _('Delete routing profile'),
            });
            deleteButton.add_css_class('flat');
            deleteButton.connect('clicked', () => this._confirmDelete(profile));
            row.add_suffix(deleteButton);

            this._profilesGroup.add(row);
            this._rows.push(row);
        }
    }

    _openProfileEditor(profile) {
        const editor = new Gtk.Window({
            title: profile ? _('Edit routing profile') : _('New routing profile'),
            transient_for: this._window,
            modal: true,
            default_width: 520,
            default_height: 500,
        });

        const content = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 18,
            margin_bottom: 18,
            margin_start: 18,
            margin_end: 18,
        });
        editor.set_child(content);

        content.append(new Gtk.Label({label: _('Name'), xalign: 0}));
        const nameEntry = new Gtk.Entry({
            text: profile?.name ?? '',
            hexpand: true,
        });
        content.append(nameEntry);

        const deleteBuffer = new Gtk.TextBuffer({
            text: profile?.deleteRoutes.join('\n') ?? 'default',
        });
        content.append(new Gtk.Label({
            label: _('Routes to remove from the Cato interface'),
            xalign: 0,
            margin_top: 6,
        }));
        content.append(this._createRouteEditor(deleteBuffer));

        const addBuffer = new Gtk.TextBuffer({
            text: profile?.addRoutes.join('\n') ?? '',
        });
        content.append(new Gtk.Label({
            label: _('Routes to route through Cato'),
            xalign: 0,
            margin_top: 6,
        }));
        content.append(this._createRouteEditor(addBuffer));

        const actions = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            halign: Gtk.Align.END,
            margin_top: 8,
        });
        content.append(actions);

        const cancelButton = new Gtk.Button({label: _('Cancel')});
        cancelButton.connect('clicked', () => editor.close());
        actions.append(cancelButton);

        const saveButton = new Gtk.Button({label: _('Save')});
        saveButton.add_css_class('suggested-action');
        saveButton.connect('clicked', () => {
            const candidate = {
                id: profile?.id ?? GLib.uuid_string_random(),
                name: nameEntry.text.trim(),
                deleteRoutes: parseRoutes(deleteBuffer.text),
                addRoutes: parseRoutes(addBuffer.text),
            };
            const error = this._validateProfile(candidate, profile?.id ?? null);
            if (error) {
                this._showMessage(_('Invalid routing profile'), error, editor);
                return;
            }

            const profiles = unpackProfiles(this._settings);
            const index = profiles.findIndex(item => item.id === candidate.id);
            if (index >= 0)
                profiles[index] = candidate;
            else
                profiles.push(candidate);
            saveProfiles(this._settings, profiles);

            editor.close();
        });
        actions.append(saveButton);

        editor.present();
    }

    _createRouteEditor(buffer) {
        const view = new Gtk.TextView({
            buffer,
            monospace: true,
            left_margin: 8,
            right_margin: 8,
            top_margin: 8,
            bottom_margin: 8,
            wrap_mode: Gtk.WrapMode.NONE,
        });
        const scroll = new Gtk.ScrolledWindow({
            min_content_height: 110,
            vexpand: true,
            has_frame: true,
        });
        scroll.set_child(view);
        return scroll;
    }

    _validateProfile(candidate, currentId) {
        if (!candidate.name)
            return _('Enter a name for the routing profile.');
        if (candidate.addRoutes.length === 0)
            return _('Enter at least one route to route through Cato.');

        const invalid = [...candidate.deleteRoutes, ...candidate.addRoutes]
            .find(route => !isValidDestination(route));
        if (invalid)
            return format(_('Invalid destination: %s'), invalid);

        const overlap = candidate.addRoutes.find(route => candidate.deleteRoutes.includes(route));
        if (overlap)
            return format(_('Route %s cannot be added and removed by the same routing profile.'), overlap);

        const indistinguishable = unpackProfiles(this._settings).find(item =>
            item.id !== currentId &&
            sameRoutes(item.addRoutes, candidate.addRoutes) &&
            sameRoutes(item.deleteRoutes, candidate.deleteRoutes)
        );
        if (indistinguishable)
            return format(_('The routing profile is indistinguishable from "%s".'), indistinguishable.name);

        return null;
    }

    _confirmDelete(profile) {
        const dialog = new Adw.MessageDialog({
            transient_for: this._window,
            heading: _('Delete routing profile?'),
            body: profile.name,
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('delete', _('Delete'));
        dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('cancel');
        dialog.set_close_response('cancel');
        dialog.connect('response', (_dialog, response) => {
            if (response !== 'delete')
                return;

            saveProfiles(
                this._settings,
                unpackProfiles(this._settings).filter(item => item.id !== profile.id)
            );
        });
        dialog.present();
    }

    _showMessage(title, body, parent) {
        const dialog = new Adw.MessageDialog({
            transient_for: parent,
            heading: title,
            body,
        });
        dialog.add_response('close', _('Close'));
        dialog.present();
    }
}
