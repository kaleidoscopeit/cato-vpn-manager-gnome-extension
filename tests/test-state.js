import {classifyRoutes, normalizeDestination, parseCatoStatus, stripTerminalSequences} from '../cato-state.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

const authenticatedOutput = `
Established an unauth tunnel
state = STATE_CONNECTED_UNAUTH
tun device  = tun0
state       = STATE_AUTHENTICATED
`;
const parsed = parseCatoStatus(authenticatedOutput);
assert(parsed.state === 'STATE_AUTHENTICATED', 'authenticated state must win');
assert(parsed.tunDevice === 'tun0', 'tun device must be parsed');

const coloredOutput = '\u001b[32mstate = STATE_AUTHENTICATED\u001b[0m\r\n\u001b[33mtun device  = tun1\u001b[0m\n';
const strippedOutput = stripTerminalSequences(coloredOutput);
assert(!strippedOutput.includes('\u001b'), 'terminal color sequences must be stripped');
const coloredParsed = parseCatoStatus(coloredOutput);
assert(coloredParsed.state === 'STATE_AUTHENTICATED', 'colored state must be parsed');
assert(coloredParsed.tunDevice === 'tun1', 'colored tun device must be parsed');

const unauthenticated = parseCatoStatus('state = STATE_CONNECTED_UNAUTH\n');
assert(unauthenticated.state === 'STATE_CONNECTED_UNAUTH', 'unauthenticated state');
assert(unauthenticated.tunDevice === null, 'missing device must remain null');

const updateOutput = `
New client version is available [5.7.0.5525], please run 'cato-sdp update'
Cato Client: 5.6.0.4138
Cato client is disconnected
`;
const updateParsed = parseCatoStatus(updateOutput);
assert(updateParsed.state === 'STATE_DISCONNECTED', 'disconnected text must be parsed');
assert(updateParsed.installedVersion === '5.6.0.4138', 'installed version must be parsed');
assert(updateParsed.availableVersion === '5.7.0.5525', 'available version must be parsed');
assert(updateParsed.updateAvailable, 'available version must set update flag');

const privacyProfile = {
    id: 'privacy',
    name: 'Privacy',
    deleteRoutes: ['default', '8.8.8.8'],
    addRoutes: ['10.12.0.0/16'],
};

let classification = classifyRoutes(
    [{dst: 'default', dev: 'tun0'}],
    'tun0',
    [privacyProfile]
);
assert(classification.mode === 'full', 'default route on Cato must be treated as connected');

classification = classifyRoutes(
    [
        {dst: 'default', dev: 'wlan0'},
        {dst: '10.12.0.0/16', dev: 'tun0'},
    ],
    'tun0',
    [privacyProfile]
);
assert(classification.mode === 'profile', 'matching routing profile must be detected');
assert(classification.activeProfile.id === 'privacy', 'active profile identity');

classification = classifyRoutes(
    [
        {dst: 'default', dev: 'wlan0'},
        {dst: '10.12.0.0/16', dev: 'tun0'},
        {dst: '10.13.0.0/16', dev: 'tun0'},
    ],
    'tun0',
    [privacyProfile]
);
assert(classification.mode === 'warning', 'unexpected Cato route must not match a profile');

classification = classifyRoutes([], 'tun0', [privacyProfile]);
assert(classification.mode === 'warning', 'partial profile must be a warning');

const staleAuthenticatedOutput = `
state = STATE_AUTHENTICATED
Cato client is disconnected
`;
assert(
    parseCatoStatus(staleAuthenticatedOutput).state === 'STATE_DISCONNECTED',
    'a later disconnected message must override an earlier state'
);

assert(normalizeDestination('192.0.2.1/32') === '192.0.2.1', 'host routes normalize');
assert(normalizeDestination('192.0.2.1/24') === null, 'host bits are rejected');
assert(normalizeDestination('0.0.0.0/0') === 'default', 'default route normalizes');
assert(!stripTerminalSequences('\x1b]0;x\x1b\\state = STATE_AUTHENTICATED\n').includes('\x1b'), 'OSC sequences are stripped');
const hostProfile = {id: 'host', name: 'Host', deleteRoutes: [], addRoutes: ['192.0.2.1/32']};
assert(
    classifyRoutes([{dst: '192.0.2.1', dev: 'tun0'}], 'tun0', [hostProfile]).mode === 'profile',
    'route aliases must match'
);
print('State parser and route classifier tests passed.');
