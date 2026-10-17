// Return one spelling for each supported IPv4 destination. Reject host bits
// in network prefixes instead of silently broadening the requested route.
export function normalizeDestination(destination) {
    const value = destination.trim();
    if (value === 'default')
        return value;
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(value);
    if (!match)
        return null;
    const octets = match.slice(1, 5).map(Number);
    const prefix = match[5] === undefined ? 32 : Number(match[5]);
    if (prefix > 32 || octets.some(octet => octet > 255))
        return null;
    const address = octets.reduce((result, octet) => (result << 8) | octet, 0) >>> 0;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if (((address & mask) >>> 0) !== address)
        return null;
    if (prefix === 0)
        return 'default';
    return octets.join('.') + (prefix === 32 ? '' : `/${prefix}`);
}

export function stripTerminalSequences(output) {
    return output
        .replace(/\x1B\](?:[^\x07\x1B]|\x1B(?!\\))*(?:\x07|\x1B\\)/g, '')
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1B[@-Z\\-_]/g, '')
        .replace(/\r/g, '');
}

export function parseCatoStatus(output) {
    const rawStatus = stripTerminalSequences(output).trimEnd();
    const result = {
        state: 'STATE_UNKNOWN', tunDevice: null,
        installedVersion: null, availableVersion: null,
        updateAvailable: false, rawStatus,
    };
    // Read in output order: a later disconnect must override an earlier state.
    for (const line of rawStatus.split('\n')) {
        let match;
        if ((match = /^state\s*=\s*(STATE_[A-Z0-9_]+)/i.exec(line)))
            result.state = match[1].toUpperCase();
        else if (/^Cato client is disconnected\s*$/i.test(line))
            result.state = 'STATE_DISCONNECTED';
        else if ((match = /^tun device\s*=\s*([A-Za-z0-9_.:-]+)\s*$/.exec(line)))
            result.tunDevice = match[1];
        else if ((match = /^Cato Client:\s*([^\s]+)\s*$/.exec(line)))
            result.installedVersion = match[1];
        else if ((match = /^New client version is available\s*\[([^\]]+)\]/.exec(line)))
            result.availableVersion = match[1];
    }
    result.updateAvailable = result.availableVersion !== null;
    return result;
}

export function classifyRoutes(routes, tunDevice, profiles) {
    const catoDestinations = new Set(routes
        .filter(route => route.dev === tunDevice)
        .map(route => normalizeDestination(route.dst ?? 'default'))
        .filter(destination => destination !== null));
    if (catoDestinations.has('default'))
        return {mode: 'full', activeProfile: null};

    const matchingProfiles = profiles.filter(profile => {
        const expectedRoutes = new Set(profile.addRoutes.map(normalizeDestination));
        return expectedRoutes.size > 0 && !expectedRoutes.has(null) &&
            expectedRoutes.size === catoDestinations.size &&
            [...expectedRoutes].every(route => catoDestinations.has(route)) &&
            profile.deleteRoutes.every(route => {
                const destination = normalizeDestination(route);
                return destination !== null && !catoDestinations.has(destination);
            });
    });
    if (matchingProfiles.length === 1)
        return {mode: 'profile', activeProfile: matchingProfiles[0]};
    return {mode: 'warning', activeProfile: null};
}
