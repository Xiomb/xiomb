import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import https from "node:https";
import {execFile} from "node:child_process";
import {fileURLToPath} from "node:url";
import {ProjectError} from "../index.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..');
if (fs.existsSync(path.join(DIR, '.env'))) {
    process.loadEnvFile(path.join(DIR, '.env'));
}
for (const name of ['DEMO_HOST', 'DEMO_PROJECT_ID', 'DEMO_CORE', 'DEMO_SECRET', 'DEMO_CERT', 'DEMO_KEY']) {
    if (!process.env[name]) {
        throw new Error(`${name} not set`);
    }
}
const HOST = process.env.DEMO_HOST;
const HTTP_PORT = Number(process.env.DEMO_PORT ?? 8443);
const SOCKET_PORT = Number(process.env.DEMO_SOCKET_PORT ?? 8444);
const PROJECT_ID = process.env.DEMO_PROJECT_ID;
const CORE_TLS = process.env.DEMO_CORE_TLS === 'true';
const CORE = process.env.DEMO_CORE;
const CORE_ADDRESS = /:\d+$/.test(CORE) ? CORE : `${CORE}:${CORE_TLS ? 443 : 50052}`;
const CERT = path.resolve(DIR, process.env.DEMO_CERT);
const KEY = path.resolve(DIR, process.env.DEMO_KEY);
const STREAMLINK = process.env.DEMO_STREAMLINK ?? 'streamlink';

const PUSH_PRESET_LIST = [
    {name: 'Twitch', uri: `rtmp://live.twitch.tv/app/${process.env.DEMO_TWITCH_KEY ?? ''}`},
    {name: 'YouTube', uri: `rtmps://a.rtmps.youtube.com/live2/${process.env.DEMO_YOUTUBE_KEY ?? ''}`},
];

const FILE_MAP = {
    '/': [path.join(DIR, 'index.html'), 'text/html; charset=utf-8'],
    '/demo.js': [path.join(DIR, 'demo.js'), 'text/javascript; charset=utf-8'],
    '/xiomb.mjs': [path.join(ROOT, 'sdk/xiomb.mjs'), 'text/javascript; charset=utf-8'],
    '/xiombPlayer.css': [path.join(ROOT, 'sdk/xiombPlayer.css'), 'text/css; charset=utf-8'],
};

let project = null;

export function setProject(projectObject) {
    project = projectObject;
}

export function getSettings() {
    return {
        core: {address: CORE_ADDRESS, tls: CORE_TLS, projectID: PROJECT_ID, secret: process.env.DEMO_SECRET},
        socket: {port: SOCKET_PORT, https: {cert: CERT, key: KEY}},
    };
}

export const log = (level, message) => console.log(`${new Date().toISOString()} ${level}: ${message}`);

// логин -> {salt, hash}: первый вход регистрирует пару, дальше пускает только с тем же паролем
const LOGIN_FILE = path.resolve(DIR, process.env.DEMO_LOGIN_FILE || 'logins.json');
const userPasswordMap = new Map(fs.existsSync(LOGIN_FILE) ? Object.entries(JSON.parse(fs.readFileSync(LOGIN_FILE, 'utf8'))) : []);

const hashOf = (salt, password) => crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');

function saveUserList() {
    const tmpFile = `${LOGIN_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(Object.fromEntries(userPasswordMap), null, 4), {mode: 0o600});
    fs.renameSync(tmpFile, LOGIN_FILE);
}

function checkUser(login, password) {
    const user = typeof login === 'string' ? userPasswordMap.get(login) : null;
    if (!user) return false;
    const hash = Buffer.from(hashOf(user.salt, String(password ?? '')), 'hex');
    return crypto.timingSafeEqual(hash, Buffer.from(user.hash, 'hex'));
}

function registerUser(login, password) {
    if (typeof login !== 'string' || typeof password !== 'string' || !login.trim() || !password || login.length > 64 || password.length > 128) {
        throw new ProjectError('BAD_REQUEST', 'Bad request');
    }
    if (userPasswordMap.has(login)) {
        if (!checkUser(login, password)) {
            throw new ProjectError('FORBIDDEN', 'Wrong login or password');
        }
        return;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    userPasswordMap.set(login, {salt, hash: hashOf(salt, password)});
    saveUserList();
}

// ---------- хуки ----------

// браузер, ссылки HLS/RTSP/RTMP и WHIP — один логин и пароль
export function onAuth(socket) {
    const login = socket.getQueryVal('auth_login');
    return checkUser(login, socket.getQueryVal('auth_password')) ? {ID: login} : false;
}

export const onPublish = () => true;

export const onPlay = () => true;

export const onResume = (client, {userID}) => userID === client.getUserID();

// ---------- события ----------

export const onCoreDisconnect = error => log('core', `disconnect ${error.name}`);

export const onCoreReconnect = () => log('core', 'reconnect');

export const onClientDestroy = client => log('client', `destroy ${client.getUserID()}`);

export function onStreamStarted(info) {
    log('stream', `started ${info.name}`);
    project.notifyAll('stream.changed');
}

export function onStreamEnded(info) {
    log('stream', `ended ${info.name}`);
    project.notifyAll('stream.changed');
}

export function onMedia(mediaObject) {
    if (mediaObject.getTransport() === 'pull') setImmediate(notifyPull);
}

export function onMediaDestroy(mediaObject, reason) {
    const push = pushInfoMap.get(mediaObject.getID());
    if (push) {
        push.status = 'stop';
        push.reason = reason?.name ?? '';
        log('push', `${push.name} -> ${push.target}: stop ${push.reason}`);
        notifyPush(push.owner);
    }
    for (const info of pullInfoMap.values()) {
        if (info.ID !== mediaObject.getID() || info.stopped) continue;
        info.reason = reason?.name ?? '';
        if (!info.page) {
            info.status = 'stop';
            log('pull', `${info.source} -> ${info.name}: stop ${info.reason}`);
        } else {
            log('pull', `${info.source} -> ${info.name}: closed ${info.reason}, again in ${RETRY_MS} ms`);
            info.status = 'reconnect';
            info.timer = setTimeout(() => reopenPull(info), RETRY_MS);
        }
    }
    if (mediaObject.getTransport() === 'pull') setImmediate(notifyPull);
}

function notifyUser(login, event, data = {}) {
    for (const client of project.getClientList()) {
        if (client.getUserID() === login) client.notify(event, data);
    }
}

const RETRY_MS = 5000;
const MAX_FAILURES = 3;
const number = value => (value === '' || value == null ? 0 : Number(value));

// Адрес для показа: без пути, там бывает ключ трансляции
function hostOf(uri) {
    const url = URL.parse(uri);
    return url ? `${url.protocol}//${url.host}` : '';
}

// Push: ID медиа -> {ID, owner, name, target, status, reason}
const pushInfoMap = new Map();
const publicPush = info => ({ID: info.ID, name: info.name, target: info.target, status: info.status, reason: info.reason});

async function startPush(login, body) {
    const name = String(body.name ?? '').trim();
    const uri = String(body.uri ?? '').trim();
    const mediaObject = await project.push(name, uri, {
        video: {codec: String(body.videoCodec ?? 'auto'), bitrate: number(body.videoBitrate), keyframeInterval: 2000},
        audio: {bitrate: number(body.audioBitrate)},
    });
    const info = {ID: mediaObject.getID(), owner: login, name, target: hostOf(uri), status: mediaObject.getStatus(), reason: ''};
    pushInfoMap.set(info.ID, info);
    mediaObject.on('status', () => {
        info.status = mediaObject.getStatus();
        log('push', `${name} -> ${info.target}: ${info.status}`);
        notifyPush(login);
    });
    log('push', `${name} -> ${info.target}: started ${info.ID}`);
    trim(pushInfoMap);
    return publicPush(info);
}

// Pull: страница трансляции (адрес без расширения файла, например twitch.tv/канал)
// превращается в адрес потока через streamlink; такой адрес временный —
// закрылся не по кнопке, берём новый и забираем снова
const pullInfoMap = new Map();

function isPage(uri) {
    const url = URL.parse(uri);
    return !!url && ['http:', 'https:'].includes(url.protocol) && !/\.[a-z0-9]{2,5}$/i.test(url.pathname);
}

function streamURL(page) {
    return new Promise((resolve, reject) => {
        execFile(STREAMLINK, ['--stream-url', page, 'best'], {timeout: 30000}, (e, stdout) => {
            const url = String(stdout ?? '').trim();
            if (e || !/^https?:\/\//.test(url)) {
                reject(new ProjectError('STREAM_NOT_FOUND', 'Stream not found'));
                return;
            }
            resolve(url);
        });
    });
}

async function openPull(info) {
    const uri = info.page ? await streamURL(info.uri) : info.uri;
    const mediaObject = await project.pull(info.name, uri, info.option);
    info.ID = mediaObject.getID();
    info.status = mediaObject.getStatus();
    info.reason = '';
    mediaObject.on('status', () => {
        info.status = mediaObject.getStatus();
        if (info.status === 'publish') info.failures = 0;
        notifyPull();
    });
    log('pull', `${info.source} -> ${info.name}: started ${info.ID}`);
}

async function reopenPull(info) {
    if (info.stopped) return;
    if (++info.failures > MAX_FAILURES) {
        info.status = 'stop';
        log('pull', `${info.source} -> ${info.name}: giving up`);
        notifyPull();
        return;
    }
    info.status = 'reconnect';
    try {
        await openPull(info);
    } catch (e) {
        info.reason = e.name;
        log('pull', `${info.source} -> ${info.name}: ${e.name} ${e.message}`);
        info.timer = setTimeout(() => reopenPull(info), RETRY_MS);
        notifyPull();
    }
}

async function startPull(login, body) {
    const uri = String(body.uri ?? '').trim();
    const name = String(body.name ?? '').trim() || `pull-${Math.random().toString(36).slice(2, 8)}`;
    const page = isPage(uri);
    const option = {rtspTransport: ['tcp', 'udp'].includes(body.rtspTransport) ? body.rtspTransport : 'auto', loop: !!body.loop};
    const info = {key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ID: '', owner: login, uri, page, option,
        source: page ? uri : hostOf(uri) || uri.split('/').pop(), name, status: 'connect', reason: '', failures: 0, stopped: false};
    await openPull(info);
    pullInfoMap.set(info.key, info);
    trim(pullInfoMap);
    return publicPull(info);
}

async function stopPull(key) {
    const info = pullInfoMap.get(key);
    if (!info) {
        const mediaObject = project.getMediaObject(key.replace(/^media:/, ''));
        if (!key.startsWith('media:') || mediaObject?.getTransport() !== 'pull') {
            throw new ProjectError('MEDIA_NOT_FOUND', 'Media not found');
        }
        await project.closeMedia(mediaObject.getID());
        log('pull', `${mediaObject.getName()}: stopped`);
        return;
    }
    info.stopped = true;
    clearTimeout(info.timer);
    info.status = 'stop';
    if (info.ID) await project.closeMedia(info.ID).catch(() => {});
    log('pull', `${info.source} -> ${info.name}: stopped`);
}

const publicPull = info => ({key: info.key, ID: info.ID, source: info.source, name: info.name, status: info.status, reason: info.reason});

const pushListOf = login => [...pushInfoMap.values()].filter(info => info.owner === login).reverse().map(publicPush);
// pull, запущенные не этим сервером (например до рестарта), тоже в списке
function pullList() {
    const infoList = [...pullInfoMap.values()].reverse();
    const trackedIDSet = new Set(infoList.map(info => info.ID));
    const untrackedList = project.getMediaObjectList()
        .filter(mediaObject => mediaObject.getTransport() === 'pull' && mediaObject.getStatus() !== 'stop' && !trackedIDSet.has(mediaObject.getID()))
        .map(mediaObject => ({key: `media:${mediaObject.getID()}`, ID: mediaObject.getID(), source: '—', name: mediaObject.getName(), status: mediaObject.getStatus(), reason: ''}));
    return [...untrackedList, ...infoList.map(publicPull)];
}
const notifyPush = login => notifyUser(login, 'push.list', {pushList: pushListOf(login)});
const notifyPull = () => project.notifyAll('pull.list', {pullList: pullList()});

function trim(infoMap) {
    for (const [key, info] of infoMap) {
        if (infoMap.size <= 50) break;
        if (info.status === 'stop') infoMap.delete(key);
    }
}

const publicStream = stream => ({
    ID: stream.ID,
    name: stream.name,
    transport: stream.transport,
    createdAt: stream.createdAt,
    trackList: stream.tracks ?? [],
    recording: !!stream.recording,
    recordingURLList: stream.recordingUrls ?? [],
    snapshotURL: stream.snapshotUrl ?? '',
    viewers: stream.viewers ?? 0,
    viewerList: (stream.viewerList ?? []).map(viewer => ({userID: viewer.userID, transport: viewer.transport, status: viewer.status})),
});

async function findStream(name) {
    const streamName = String(name ?? '').trim();
    const stream = (await project.listStreams()).find(info => info.name === streamName);
    if (!stream) {
        throw new ProjectError('STREAM_NOT_FOUND', 'Stream not found');
    }
    return stream;
}

// ---------- команды страницы через сокет SDK ----------

function command(type, fn) {
    return async (client, data) => {
        try {
            return await fn(client.getUserID(), data ?? {});
        } catch (e) {
            log('demo', `${type} ${e.name} ${e.message}`);
            throw e instanceof ProjectError ? e : new ProjectError(e.name || 'INTERNAL', e.message);
        }
    };
}

export const onStreamList = command('stream.list', async () => ({
    streamList: (await project.listStreams()).map(publicStream),
}));

export const onStreamSnapshot = command('stream.snapshot', async (login, {name}) => ({url: await project.snapshot((await findStream(name)).name)}));

export const onStreamRecord = command('stream.record', async (login, {name, enabled}) => {
    await project.setRecording((await findStream(name)).name, !!enabled);
    return {};
});

export const onStreamKill = command('stream.kill', async (login, {name}) => {
    await project.killStream((await findStream(name)).name, 'Stopped');
    return {};
});

export const onPushList = command('push.list', async login => ({pushList: pushListOf(login)}));

export const onPushStart = command('push.start', async (login, data) => {
    const info = await startPush(login, data);
    notifyPush(login);
    return info;
});

export const onPushStop = command('push.stop', async (login, {ID}) => {
    const info = pushInfoMap.get(String(ID ?? ''));
    if (!info || info.owner !== login) {
        throw new ProjectError('MEDIA_NOT_FOUND', 'Media not found');
    }
    await project.closeMedia(info.ID);
    return {};
});

export const onPullList = command('pull.list', async () => ({pullList: pullList()}));

export const onPullStart = command('pull.start', async (login, data) => {
    const info = await startPull(login, data);
    notifyPull();
    return info;
});

export const onPullStop = command('pull.stop', async (login, {key}) => {
    await stopPull(String(key ?? ''));
    notifyPull();
    return {};
});

export const onPullStopAll = command('pull.stopAll', async () => {
    const keyList = pullList().filter(info => info.status !== 'stop').map(info => info.key);
    await Promise.all(keyList.map(key => stopPull(key).catch(() => {})));
    notifyPull();
    return {stopped: keyList.length};
});

// ---------- HTTP страницы демо ----------

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 4096) req.destroy();
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

function sendJSON(res, status, data) {
    res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-cache'});
    res.end(JSON.stringify(data));
}

const LINK_GETTER_MAP = {
    hls: (name, options) => project.getHlsURL(name, options),
    rtsp: (name, options) => project.getRtspURL(name, options),
    rtsps: (name, options) => project.getRtspsURL(name, options),
    rtmp: (name, options) => project.getRtmpURL(name, options),
    rtmps: (name, options) => project.getRtmpsURL(name, options),
};

function linkMapOf(name, options) {
    const linkMap = {};
    for (const [transport, getURL] of Object.entries(LINK_GETTER_MAP)) {
        try {
            linkMap[transport] = getURL(name, options);
        } catch (e) {
            if (e.name !== 'LINK_NOT_SET') throw e;
        }
    }
    return linkMap;
}

function config() {
    return {
        url: `wss://${HOST}:${SOCKET_PORT}`,
        projectID: PROJECT_ID,
        whipURL: `https://${HOST}:${SOCKET_PORT}/whip`,
        pageURL: `https://${HOST}:${HTTP_PORT}/`,
        pushPresetList: PUSH_PRESET_LIST,
    };
}

export function startHttpServer() {
    https.createServer({cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY)}, async (req, res) => {
        const pathname = URL.parse(req.url, 'https://localhost')?.pathname ?? '';
        if (pathname === '/config.json') {
            sendJSON(res, 200, config());
            return;
        }
        if (pathname === '/login' && req.method === 'POST') {
            try {
                const {login, password} = JSON.parse(await readBody(req) || '{}');
                registerUser(login, password);
                log('user', `login ${login}`);
                sendJSON(res, 200, {login});
            } catch (e) {
                const error = e.name === 'FORBIDDEN' ? e : new ProjectError('BAD_REQUEST', 'Bad request');
                sendJSON(res, error.name === 'FORBIDDEN' ? 401 : 400, {name: error.name, message: error.message});
            }
            return;
        }
        if (pathname === '/streams.json') {
            const query = URL.parse(req.url, 'https://localhost').searchParams;
            if (!checkUser(query.get('auth_login'), query.get('auth_password'))) {
                sendJSON(res, 401, {name: 'FORBIDDEN', message: 'Wrong login or password'});
                return;
            }
            try {
                sendJSON(res, 200, {streamList: (await project.listStreams()).map(stream => ({name: stream.name, transport: stream.transport, viewers: stream.viewers ?? 0}))});
            } catch (e) {
                sendJSON(res, 503, {name: e.name, message: e.message});
            }
            return;
        }
        if (pathname === '/links.json') {
            const query = URL.parse(req.url, 'https://localhost').searchParams;
            const login = query.get('auth_login');
            const password = query.get('auth_password');
            if (!checkUser(login, password)) {
                sendJSON(res, 401, {name: 'FORBIDDEN', message: 'Wrong login or password'});
                return;
            }
            try {
                sendJSON(res, 200, linkMapOf(query.get('name') ?? '', {login, password}));
            } catch (e) {
                sendJSON(res, 503, {name: e.name, message: e.message});
            }
            return;
        }
        const file = FILE_MAP[pathname];
        if (!file) {
            res.writeHead(404);
            res.end();
            return;
        }
        fs.readFile(file[0], (e, body) => {
            res.writeHead(e ? 404 : 200, {'content-type': file[1], 'cache-control': 'no-cache'});
            res.end(e ? undefined : body);
        });
    }).listen(HTTP_PORT, () => log('system', `demo: https://${HOST}:${HTTP_PORT}/`));
}
