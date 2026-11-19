import ObjectExtend from "./ObjectExtend.js";
import {ProjectError} from "./ProjectError.js";
import {CoreLink} from "./CoreLink.js";
import {Media} from "./Media.js";
import {Clients} from "./Clients.js";
import {Whip} from "./Whip.js";
import {encodeData, decodeData} from "./Data.js";

const HOOKS = ['auth', 'publish', 'play', 'rtsp', 'resume'];
const DEFAULT_CORE_ADDRESS = 'eu-test.xiomb.com:443';

export class XiombProject extends ObjectExtend {
    #settings;
    #hookMap = new Map();
    #hlsEntry = null;
    #linkProjectID = '';
    #linkMap = null;
    #messageHandlerMap = new Map();
    #coreLink;
    #mediaApp;
    #clientsApp;
    #whipApp;

    constructor(settings) {
        super();
        this.#settings = XiombProject.#normalize(settings);
        this.#coreLink = new CoreLink(this, this.#settings.core);
        this.#mediaApp = new Media(this);
        this.#clientsApp = new Clients(this);
        this.#whipApp = new Whip(this);
        this.#coreLink.on('disconnect', error => this.emit('core|disconnect', {name: error.name, message: error.message}));
        this.#coreLink.on('reconnect', info => this.emit('core|reconnect', info));
        this.#coreLink.on('retry', info => this.#onRetry(info));
    }

    static #normalize(settings = {}) {
        const core = settings.core ?? {};
        const socket = settings.socket ?? {};
        for (const key of ['projectID', 'secret']) {
            if (typeof core[key] !== 'string' || !core[key]) {
                throw new Error(`Unknown settings.core.${key}`);
            }
        }
        const isDefaultCore = !core.address && !core.portalURL;
        if (!socket.port) {
            throw new Error('Unknown settings.socket.port');
        }
        return {
            core: {
                address: isDefaultCore ? DEFAULT_CORE_ADDRESS : core.address ?? '',
                portalURL: String(core.portalURL ?? '').replace(/\/+$/, ''),
                failoverTimeout: core.failoverTimeout ?? 20000,
                projectID: core.projectID,
                secret: core.secret,
                tls: core.tls ?? isDefaultCore,
                requestTimeout: core.requestTimeout ?? 15000,
                reconnectMax: core.reconnectMax ?? 10000,
                giveUpAfter: core.giveUpAfter ?? 0,
                closeClientsOnLost: core.closeClientsOnLost ?? true,
            },
            socket: {
                port: socket.port,
                host: socket.host,
                https: socket.https ?? {},
                socketObjectTimeout: socket.socketObjectTimeout ?? 10000,
                originList: socket.originList ?? [],
            },
            hookTimeout: settings.hookTimeout ?? 10000,
            resumeTimeout: settings.resumeTimeout ?? 30000,
            logger: settings.logger ?? null,
        };
    }

    getSettings() {
        return this.#settings;
    }

    #onRetry(info) {
        this.emit('core|retry', info);
        const giveUpAfter = this.#settings.core.giveUpAfter;
        if (!giveUpAfter || info.attempt !== giveUpAfter || !this.isCreateObject()) {
            return;
        }
        this.log('warning', `core: still unreachable after ${info.attempt} attempt(s)`);
        this.emit('core|lost', {attempts: info.attempt});
        if (this.#settings.core.closeClientsOnLost) {
            for (const client of this.getClientList()) {
                client.lost();
            }
        }
    }

    notifyAll(event, data = {}) {
        for (const client of this.getClientList()) {
            client.notify(event, data);
        }
    }

    getCoreLink() {
        return this.#coreLink;
    }

    getMediaApp() {
        return this.#mediaApp;
    }

    getClientsApp() {
        return this.#clientsApp;
    }

    getWhipApp() {
        return this.#whipApp;
    }

    log(level, message) {
        this.emit('log', level, message);
        if (this.#settings.logger) {
            this.#settings.logger(level, message);
        } else if (level === 'error' || level === 'warning') {
            console.error(`[xiomb] ${level}: ${message}`);
        }
    }

    use(name, fn) {
        if (!HOOKS.includes(name)) {
            throw new Error(`Unknown hook ${name}`);
        }
        if (typeof fn !== 'function') {
            throw new Error(`Hook ${name} is not a function`);
        }
        this.#hookMap.set(name, fn);
        return this;
    }

    /**
     * Вход HLS ядра для браузеров: {url, projectID} или null
     * @param hlsEntry
     */
    setHlsEntry(hlsEntry) {
        this.#hlsEntry = hlsEntry;
    }

    getHlsEntry() {
        return this.#hlsEntry;
    }

    hasHook(name) {
        return this.#hookMap.has(name);
    }

    handle(type, fn) {
        if (typeof type !== 'string' || type.startsWith('media.') || type.startsWith('session.')) {
            throw new Error(`Reserved message ${type}`);
        }
        if (typeof fn !== 'function') {
            throw new Error(`Handler ${type} is not a function`);
        }
        this.#messageHandlerMap.set(type, fn);
        return this;
    }

    async callMessageHandler(type, client, data) {
        const handler = this.#messageHandlerMap.get(type)
            ?? [...this.#messageHandlerMap].find(([key]) => key.endsWith('*') && type.startsWith(key.slice(0, -1)))?.[1];
        if (!handler) {
            throw new ProjectError('BAD_REQUEST');
        }
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(() => handler(client, data, type)),
                new Promise((resolve, reject) => {
                    timer = setTimeout(() => reject(new ProjectError('TIMEOUT')), this.#settings.hookTimeout);
                }),
            ]);
        } catch (e) {
            throw e instanceof ProjectError ? e.setCustom() : e;
        } finally {
            clearTimeout(timer);
        }
    }

    async callHook(name, ...args) {
        const hook = this.#hookMap.get(name);
        if (!hook) {
            throw new ProjectError('FORBIDDEN');
        }
        let timer;
        try {
            const result = await Promise.race([
                Promise.resolve().then(() => hook(...args)),
                new Promise((resolve, reject) => {
                    timer = setTimeout(() => reject(new ProjectError('TIMEOUT')), this.#settings.hookTimeout);
                }),
            ]);
            if (result === false || result === null || result === undefined) {
                throw new ProjectError('FORBIDDEN');
            }
            return result;
        } catch (e) {
            if (e instanceof ProjectError) {
                throw e.name === 'TIMEOUT' ? e : e.setCustom();
            }
            this.log('debug', `hook ${name}: ${e?.message ?? e}`);
            throw new ProjectError('FORBIDDEN');
        } finally {
            clearTimeout(timer);
        }
    }

    async start() {
        await this.#coreLink.start();
        await this.#clientsApp.start();
        await this.create();
        this.emit('ready', this);
        return this;
    }

    async stop(reason = 'stop') {
        await this.#clientsApp.destroy(reason);
        await this.#coreLink.destroy(reason);
        return this.destroy(reason);
    }

    getClient(ID) {
        return this.#clientsApp.getClient(ID);
    }

    getClientList() {
        return this.#clientsApp.getClientList();
    }

    getMediaObject(ID) {
        return this.#mediaApp.getMediaObject(ID);
    }

    getMediaObjectList() {
        return this.#mediaApp.getMediaObjectList();
    }

    async closeMedia(ID, reason = null) {
        const mediaObject = this.#mediaApp.getMediaObject(ID);
        if (!mediaObject) {
            throw new ProjectError('MEDIA_NOT_FOUND');
        }
        const error = reason instanceof ProjectError ? reason : (reason ? new ProjectError(String(reason)) : null);
        await this.#mediaApp.closeMediaObject(mediaObject, error ? error.setCustom() : new ProjectError('MEDIA_TERMINATED'));
    }

    getStreamInfo(stream) {
        return {
            ID: stream.media_id,
            name: stream.name,
            transport: XiombProject.#enum(stream.transport, 'TRANSPORT_'),
            userID: stream.user_id,
            data: decodeData(stream.data),
            createdAt: stream.created_unix_ms,
            tracks: stream.tracks.map(track => ({
                kind: track.kind,
                codec: track.codec,
                width: track.width,
                height: track.height,
                fps: track.fps,
                bitrate: track.bitrate_bps,
                live: track.live,
                // B-кадры: зрителям WebRTC поток перекодируют
                reordersFrames: !!track.reorders_frames,
            })),
            recording: stream.recording,
            viewers: stream.viewers,
            snapshotUrl: stream.snapshot_url,
            recordingUrls: stream.recording_urls,
            viewerList: stream.viewer_list.map(viewer => ({
                ID: viewer.media_id,
                userID: viewer.user_id,
                data: decodeData(viewer.data),
                transport: XiombProject.#enum(viewer.transport, 'TRANSPORT_'),
                status: XiombProject.#enum(viewer.status, 'MEDIA_STATUS_'),
                createdAt: viewer.created_unix_ms,
            })),
        };
    }

    static #enum(value, prefix) {
        return String(value).replace(prefix, '').toLowerCase();
    }

    /**
     * Входы облака для ссылок, от ядра при подключении
     * @param projectID
     * @param links {hls, rtsp, rtsps, rtmp, rtmps}
     */
    setLinks(projectID, links) {
        this.#linkProjectID = projectID;
        this.#linkMap = links;
    }

    /**
     * Ссылка для плеера, камеры, OBS: <вход облака>/<проект>/<поток>?auth_login&auth_password&параметры
     * @param transport hls | rtsp | rtsps | rtmp | rtmps
     * @param name поток
     * @param options {login, password, ...параметры для хука auth}
     * @returns {string}
     */
    getTransportURL(transport, name, {login, password, ...params} = {}) {
        if (!this.#linkMap) {
            throw new ProjectError('SERVICE_UNAVAILABLE');
        }
        if (!['hls', 'rtsp', 'rtsps', 'rtmp', 'rtmps'].includes(transport)) {
            throw new ProjectError('BAD_REQUEST', 'Bad transport');
        }
        const base = this.#linkMap[transport];
        if (!base) {
            throw new ProjectError('LINK_NOT_SET');
        }
        const query = new URLSearchParams();
        if (login !== undefined) {
            query.set('auth_login', String(login));
        }
        if (password !== undefined) {
            query.set('auth_password', String(password));
        }
        for (const [key, value] of Object.entries(params)) {
            query.set(key, String(value));
        }
        const search = query.toString();
        return `${base}/${encodeURIComponent(this.#linkProjectID)}/${encodeURIComponent(String(name))}${search ? `?${search}` : ''}`;
    }

    getHlsURL(name, options) {
        return this.getTransportURL('hls', name, options);
    }

    getRtspURL(name, options) {
        return this.getTransportURL('rtsp', name, options);
    }

    getRtspsURL(name, options) {
        return this.getTransportURL('rtsps', name, options);
    }

    getRtmpURL(name, options) {
        return this.getTransportURL('rtmp', name, options);
    }

    getRtmpsURL(name, options) {
        return this.getTransportURL('rtmps', name, options);
    }

    async listStreams({projectID = ''} = {}) {
        return (await this.#coreLink.listStreams(projectID)).map(stream => this.getStreamInfo(stream));
    }

    snapshot(name, {projectID = ''} = {}) {
        return this.#coreLink.snapshot(name, projectID);
    }

    setRecording(name, enabled, {projectID = ''} = {}) {
        return this.#coreLink.setRecording(name, !!enabled, projectID);
    }

    killStream(name, reason = '') {
        return this.#coreLink.killStream(name, String(reason));
    }

    static #count(value) {
        const number = Number(value ?? 0);
        if (!Number.isInteger(number) || number < 0) {
            throw new ProjectError('BAD_REQUEST');
        }
        return number;
    }

    async push(name, uri, {video = {}, audio = {}, data} = {}) {
        const created = await this.#coreLink.push({
            name,
            uri,
            video: {
                codec: String(video.codec ?? ''),
                bitrate_kbps: XiombProject.#count(video.bitrate),
                keyframe_interval_ms: XiombProject.#count(video.keyframeInterval),
                disabled: !!video.disabled,
            },
            audio: {
                codec: String(audio.codec ?? ''),
                bitrate_kbps: XiombProject.#count(audio.bitrate),
                disabled: !!audio.disabled,
            },
            data: encodeData(data),
        });
        return this.#mediaApp.addMediaObject({ID: created.media_id, sessionID: created.session_id, name, direction: 'push', transport: 'push', data: data ?? null});
    }

    async pull(name, uri, {rtspTransport = '', loop = false, data} = {}) {
        const created = await this.#coreLink.pull({name, uri, rtsp_transport: rtspTransport, loop: !!loop, data: encodeData(data)});
        return this.#mediaApp.addMediaObject({ID: created.media_id, sessionID: created.session_id, name, direction: 'publish', transport: 'pull', data: data ?? null});
    }
}
