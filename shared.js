import Gio from 'gi://Gio';
import {normalizeDestination} from './cato-state.js';

const ROUTE_HELPER = '/usr/libexec/cato-vpn-route-helper';

export function detectRouteHelper() {
    // The privileged executable must be installed by root and not writable by
    // other users. Its parent directory is the system-owned /usr/libexec.
    try {
        const info = Gio.File.new_for_path(ROUTE_HELPER).query_info(
            'access::can-execute,unix::uid,unix::mode',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null
        );
        const mode = info.get_attribute_uint32('unix::mode');
        return (mode & 0o170000) === 0o100000 &&
            info.get_attribute_boolean('access::can-execute') &&
            info.get_attribute_uint32('unix::uid') === 0 &&
            (mode & 0o022) === 0
            ? ROUTE_HELPER : null;
    } catch (error) {
        if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            console.warn(`CatoVPN: cannot inspect route helper: ${error.message}`);
        return null;
    }
}

export function unpackProfiles(settings) {
    return settings.get_value('route-profiles').deepUnpack().map(profile => ({
        id: profile[0], name: profile[1],
        deleteRoutes: [...new Set(profile[2].map(route => normalizeDestination(route) ?? route))],
        addRoutes: [...new Set(profile[3].map(route => normalizeDestination(route) ?? route))],
    }));
}

export function format(text, ...values) {
    let index = 0;
    return text.replace(/%s/g, () => values[index++]);
}
