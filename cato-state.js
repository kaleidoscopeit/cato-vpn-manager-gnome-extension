export function normalizeDestination(destination) {
    const value = destination.trim();
    return value === '0.0.0.0/0' ? 'default' : value;
}

export function stripTerminalSequences(output) {
    return output
        .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1B[@-Z\\-_]/g, '')
        .replace(/\r/g, '');
}

export function parseCatoStatus(output) {
    const cleanedOutput = stripTerminalSequences(output);
    const states = [...cleanedOutput.matchAll(/^state\s*=\s*(STATE_[A-Z0-9_]+)/gm)]
        .map(match => match[1]);

    let state = states.at(-1) ?? 'STATE_UNKNOWN';
    const lastStateMatch = [...cleanedOutput.matchAll(
        /^state\s*=\s*(STATE_[A-Z0-9_]+)/gmi
    )].at(-1);
    const disconnectedMatch = /^Cato client is disconnected\s*$/mi.exec(cleanedOutput);
    if (disconnectedMatch && (!lastStateMatch || disconnectedMatch.index > lastStateMatch.index))
        state = 'STATE_DISCONNECTED';

    const deviceMatch = cleanedOutput.match(/^tun device\s*=\s*([A-Za-z0-9_.:-]+)\s*$/m);
    const installedVersionMatch = cleanedOutput.match(/^Cato Client:\s*([^\s]+)\s*$/m);
    const availableVersionMatch = cleanedOutput.match(
        /^New client version is available\s*\[([^\]]+)\]/m
    );

    return {
        state,
        tunDevice: deviceMatch?.[1] ?? null,
        installedVersion: installedVersionMatch?.[1] ?? null,
        availableVersion: availableVersionMatch?.[1] ?? null,
        updateAvailable: Boolean(availableVersionMatch),
    };
}

export function classifyRoutes(routes, tunDevice, profiles) {
    const normalizedRoutes = routes.map(route => ({
        destination: normalizeDestination(route.dst ?? 'default'),
        device: route.dev ?? null,
    }));
    const isOnCato = destination => normalizedRoutes.some(route =>
        route.destination === normalizeDestination(destination) &&
        route.device === tunDevice
    );

    if (isOnCato('default'))
        return {mode: 'full', activeProfile: null};

    const catoDestinations = new Set(
        normalizedRoutes
            .filter(route => route.device === tunDevice)
            .map(route => route.destination)
    );
    const matchingProfiles = profiles.filter(profile => {
        const expectedRoutes = new Set(profile.addRoutes.map(normalizeDestination));
        return expectedRoutes.size === catoDestinations.size &&
            profile.addRoutes.every(isOnCato) &&
            profile.deleteRoutes.every(route => !isOnCato(route));
    });

    if (matchingProfiles.length === 1)
        return {mode: 'profile', activeProfile: matchingProfiles[0]};

    return {mode: 'warning', activeProfile: null};
}
