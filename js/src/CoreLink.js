import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import ObjectExtend from "./ObjectExtend.js";
import {ProjectError} from "./ProjectError.js";
import {encodeData} from "./Data.js";
import {UrlClient, UrlSocket} from "./UrlClient.js";

const PROTO_DIR = [['..', 'proto'], ['..', '..', 'proto']]
    .map(parts => path.join(path.dirname(fileURLToPath(import.meta.url)), ...parts))
    .find(dir => fs.existsSync(path.join(dir, 'xiomb/v1/project.proto')));
const BACKOFF_MIN = 500;
const PORTAL_TIMEOUT = 5000;

export class CoreLink extends ObjectExtend {
    #project;
    #settings;
    #projectService;
    #client = null;
    #credentials;
    #address = '';
    #resolveRequired = false;
    #lostAt = 0;
    #call = null;
    #ready = false;
    #stopped = false;
    #backoff = BACKOFF_MIN;
    #timer = null;
    #attempts = 0;
    #wasReady = false;
    #syncing = Promise.resolve();
    #pendingRequestMap = new Map();

    constructor(project, settings) {
        super();
        this.#project = project;
        this.#settings = settings;
        const definition = protoLoader.loadSync('xiomb/v1/project.proto', {
            includeDirs: [PROTO_DIR],
            keepCase: true,
            longs: Number,
            enums: String,
            defaults: true,
            oneofs: true,
        });
        this.#projectService = grpc.loadPackageDefinition(definition).xiomb.v1.ProjectService;
        this.#credentials = settings.tls
            ? grpc.credentials.createSsl(settings.tls === true ? null : settings.tls.ca ?? null)
            : grpc.credentials.createInsecure();
        this.#resolveRequired = !!settings.portalURL;
        if (settings.address) {
            this.#setAddress(settings.address);
        }
    }

    /**
     * @returns {string} адрес ядра, с которым работаем
     */
    getAddress() {
        return this.#address;
    }

    #setAddress(address) {
        if (address === this.#address && this.#client) {
            return;
        }
        this.#client?.close();
        this.#address = address;
        this.#client = new this.#projectService(address, this.#credentials, {
            'grpc.keepalive_time_ms': 20000,
            'grpc.keepalive_timeout_ms': 10000,
            'grpc.keepalive_permit_without_calls': 1,
        });
    }

    /**
     * Адрес ядра у портала: домашнее, а при его аварии другое
     * @returns {Promise<void>}
     */
    async #resolveAddress() {
        const response = await fetch(`${this.#settings.portalURL}/api/project/core`, {
            headers: {
                'authorization': `Bearer ${this.#settings.secret}`,
                'x-project-id': this.#settings.projectID,
                'accept': 'application/json',
            },
            signal: AbortSignal.timeout(PORTAL_TIMEOUT),
        });
        if (response.status === 401 || response.status === 403) {
            const error = new ProjectError(response.status === 401 ? 'PROJECT_AUTH_FAILED' : 'PROJECT_DISABLED');
            error.fatal = true;
            throw error;
        }
        if (response.status !== 200) {
            throw new Error(`portal ${response.status}`);
        }
        const {endpoint} = await response.json();
        if (!endpoint) {
            throw new Error('portal: no endpoint');
        }
        this.#resolveRequired = false;
        if (endpoint !== this.#address) {
            this.#project.log('system', `core: ${this.#address ? `switching ${this.#address} ->` : 'using'} ${endpoint}`);
            this.#setAddress(endpoint);
        }
    }

    isReady() {
        return this.#ready;
    }

    start() {
        return new Promise((resolve, reject) => {
            const onReady = () => {
                this.off('fatal', onFatal);
                resolve(this);
            };
            const onFatal = error => {
                this.off('ready', onReady);
                reject(error);
            };
            this.once('ready', onReady);
            this.once('fatal', onFatal);
            this.#connect();
        });
    }

    async destroy(destroyMessage) {
        this.#stopped = true;
        clearTimeout(this.#timer);
        this.#call?.cancel();
        this.#client?.close();
        return super.destroy(destroyMessage);
    }

    #connect() {
        if (this.#stopped) {
            return;
        }
        if (!this.#resolveRequired) {
            return this.#openCall();
        }
        this.#resolveAddress().then(() => this.#openCall(), e => {
            if (this.#stopped) {
                return;
            }
            if (e.fatal) {
                this.#project.log('error', `portal: ${e.name}`);
                this.emit('fatal', e);
                this.emit('disconnect', e);
                return;
            }
            this.#project.log('warning', `portal: ${e.message}`);
            if (this.#client) {
                return this.#openCall();
            }
            this.#retry(null, e.message);
        });
    }

    #openCall() {
        if (this.#stopped) {
            return;
        }
        const metadata = new grpc.Metadata();
        metadata.set('x-project-id', this.#settings.projectID);
        metadata.set('authorization', `Bearer ${this.#settings.secret}`);
        const call = this.#client.Connect(metadata);
        this.#call = call;
        call.on('data', message => this.#dispatch(message));
        call.on('error', e => this.#onClose(call, e));
        call.on('end', () => this.#onClose(call, null));
    }

    #onClose(call, status) {
        if (this.#call !== call) {
            return;
        }
        this.#call = null;
        const wasReady = this.#ready;
        this.#ready = false;
        for (const [, pending] of this.#pendingRequestMap) {
            clearTimeout(pending.timer);
            pending.reject(new ProjectError('CORE_UNAVAILABLE'));
        }
        this.#pendingRequestMap.clear();

        const name = status?.metadata?.get('xiomb-error-name')[0];
        if (status && (status.code === grpc.status.UNAUTHENTICATED || status.code === grpc.status.PERMISSION_DENIED)) {
            const error = new ProjectError(String(name || 'FORBIDDEN'));
            this.#project.log('error', `core: ${error.name}`);
            this.emit('fatal', error);
            this.emit('disconnect', error);
            return;
        }
        if (wasReady) {
            this.emit('disconnect', new ProjectError('CORE_UNAVAILABLE'));
        }
        if (this.#stopped) {
            return;
        }
        this.#lostAt ||= Date.now();
        const moved = name === 'PROJECT_MOVED';
        if (this.#settings.portalURL && (moved || Date.now() - this.#lostAt >= this.#settings.failoverTimeout)) {
            this.#resolveRequired = true;
        }
        if (moved) {
            this.#backoff = BACKOFF_MIN;
        }
        this.#retry(wasReady, name || status?.details || 'stream ended');
    }

    /**
     * @param wasReady null — до подключения к ядру (портал)
     * @param reason
     */
    #retry(wasReady, reason) {
        const delay = this.#backoff;
        this.#project.log('warning', `core: disconnected (${reason}), reconnect in ${delay} ms`);
        this.#timer = setTimeout(() => this.#connect(), delay);
        this.#backoff = Math.min(this.#backoff * 2, this.#settings.reconnectMax);
        if (!wasReady) {
            this.#attempts++;
            this.emit('retry', {attempt: this.#attempts, delay});
        }
    }

    #dispatch(message) {
        try {
            this.route(message);
        } catch (e) {
            this.#project.log('error', `core: ${message.body}: ${e?.stack ?? e}`);
        }
    }

    route(message) {
        const requestID = message.request_id;
        switch (message.body) {
            case 'ready':
                return this.gRPC_ready(message.ready);
            case 'result':
                return this.gRPC_result(message.result, requestID);
            case 'signal':
                return this.gRPC_signal(message.signal);
            case 'authorize':
                return this.gRPC_authorize(message.authorize, requestID);
            case 'stream_started':
                return this.gRPC_stream_started(message.stream_started);
            case 'stream_ended':
                return this.gRPC_stream_ended(message.stream_ended);
            case 'media_closed':
                return this.gRPC_media_closed(message.media_closed);
            case 'media_status':
                return this.gRPC_media_status(message.media_status);
            case 'media_opened':
                return this.gRPC_media_opened(message.media_opened);
            case 'media_stats':
                return this.gRPC_media_stats(message.media_stats);
            case 'media_snapshot':
                return this.gRPC_media_snapshot(message.media_snapshot);
            default:
                this.#project.log('warning', `core: unknown event "${message.body}"`);
        }
    }

    gRPC_ready(ready) {
        this.#ready = true;
        this.#project.setHlsEntry(ready.hls_url ? {url: ready.hls_url, projectID: ready.project_id} : null);
        this.#project.setLinks(ready.project_id, ready.links ?? {});
        this.#lostAt = 0;
        this.#backoff = BACKOFF_MIN;
        const attempts = this.#attempts;
        const restored = this.#wasReady;
        this.#attempts = 0;
        this.#wasReady = true;
        this.#project.log('system', `core: ready as project ${ready.project_id}${restored ? ` (restored after ${attempts} failed attempt(s))` : ''}`);
        this.#syncing = this.#project.getMediaApp().sync()
            .catch(e => this.#project.log('warning', `core: media sync failed: ${e.name ?? e}`))
            .then(() => {
                if (restored) {
                    this.emit('reconnect', {attempts});
                }
                this.emit('ready', ready);
            });
    }

    gRPC_result(result, requestID) {
        const pending = this.#pendingRequestMap.get(requestID);
        if (!pending) {
            return;
        }
        this.#pendingRequestMap.delete(requestID);
        clearTimeout(pending.timer);
        const error = ProjectError.fromProto(result.error);
        error ? pending.reject(error) : pending.resolve(result);
    }

    gRPC_signal(signal) {
        this.#project.getMediaApp().coreSignal(signal);
    }

    async gRPC_authorize(authorize, requestID) {
        let error = null;
        let data = '';
        let userID = '';
        const direction = authorize.direction === 'DIRECTION_PUBLISH' ? 'publish' : 'play';
        const transport = {TRANSPORT_RTMP: 'rtmp', TRANSPORT_HLS: 'hls'}[authorize.transport] ?? 'rtsp';
        const paramMap = authorize.params ?? {};
        try {
            if (this.#project.hasHook('rtsp')) {
                // старый путь: один хук на все подключения по ссылке
                const allowed = await this.#project.callHook('rtsp', {
                    userID: authorize.user_id,
                    token: authorize.token,
                    name: authorize.name,
                    direction,
                    transport,
                    remoteAddress: authorize.remote_address,
                    userAgent: authorize.user_agent ?? '',
                    params: {...paramMap},
                });
                if (typeof allowed === 'object' && 'data' in allowed) {
                    data = encodeData(allowed.data);
                }
            } else {
                // как у браузера: auth по параметрам ссылки, затем publish или play
                const socket = new UrlSocket(paramMap, authorize.remote_address, authorize.user_agent ?? '');
                const user = await this.#project.callHook('auth', socket);
                const client = new UrlClient(user, socket, transport);
                const allowed = await this.#project.callHook(direction, client, {name: authorize.name, transport, custom: {}});
                // имя потока задано ссылкой: другое имя от хука не принимаем
                const renamed = typeof allowed === 'string' ? allowed : typeof allowed === 'object' ? allowed.name : undefined;
                if ((allowed !== true && typeof allowed !== 'object' && typeof allowed !== 'string') ||
                    (renamed && renamed !== authorize.name)) {
                    throw new ProjectError('FORBIDDEN');
                }
                const mediaData = typeof allowed === 'object' && 'data' in allowed ? allowed.data : user?.data;
                data = mediaData === undefined ? '' : encodeData(mediaData);
                userID = client.getUserID();
            }
        } catch (e) {
            if (!(e instanceof ProjectError)) {
                this.#project.log('error', `hook ${transport} ${direction}: ${e?.message ?? e}`);
            }
            error = {name: 'PROJECT_DENIED', message: ''};
        }
        this.#send({request_id: requestID, authorize_result: {error, data, user_id: userID}});
    }

    gRPC_stream_started(started) {
        this.#project.emit('stream|started', this.#project.getStreamInfo(started.stream));
    }

    gRPC_stream_ended(ended) {
        this.#project.emit('stream|ended', {name: ended.name, reason: ProjectError.fromProto(ended.reason)?.toPublic() ?? null});
    }

    gRPC_media_closed(closed) {
        this.#project.getMediaApp().coreClosed(closed.media_id, ProjectError.fromProto(closed.reason));
    }

    gRPC_media_stats(list) {
        this.#project.getMediaApp().coreStats(list.stats);
    }

    gRPC_media_snapshot(snapshot) {
        this.#project.getMediaApp().coreSnapshot(snapshot.media_id, snapshot.url);
    }

    gRPC_media_opened(opened) {
        this.#project.getMediaApp().coreOpened(opened.media);
    }

    gRPC_media_status(status) {
        this.#project.getMediaApp().coreStatus(status.media_id, status.status, status.renegotiate, ProjectError.fromProto(status.reason));
    }

    #send(message) {
        if (!this.#call) {
            return false;
        }
        this.#call.write(message);
        return true;
    }

    #request(body, payload) {
        if (!this.#ready) {
            return Promise.reject(new ProjectError('CORE_UNAVAILABLE'));
        }
        const requestID = randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#pendingRequestMap.delete(requestID);
                reject(new ProjectError('TIMEOUT'));
            }, this.#settings.requestTimeout);
            this.#pendingRequestMap.set(requestID, {resolve, reject, timer});
            this.#send({request_id: requestID, [body]: payload});
        });
    }

    synced() {
        return this.#syncing;
    }

    async #create(body, payload) {
        await this.#syncing;
        return (await this.#request(body, payload)).media;
    }

    publish(publish) {
        return this.#create('publish', publish);
    }

    play(play) {
        return this.#create('play', play);
    }

    renegotiate(renegotiate) {
        return this.#create('renegotiate', renegotiate);
    }

    async issueTurn(clientID) {
        return (await this.#request('issue_turn', {client_id: clientID})).turn;
    }

    async listMedia() {
        return (await this.#request('list_media', {})).media_list.media;
    }

    async getMediaStats(mediaID) {
        return (await this.#request('get_media_stats', {media_id: mediaID})).media_stats;
    }

    signal(signal) {
        this.#send({signal});
    }

    async closeMedia(mediaID, reason = null) {
        await this.#request('close_media', {media_id: mediaID, reason});
    }

    async killStream(name, reason = '') {
        await this.#request('kill_stream', {name, reason});
    }

    async setRecording(name, enabled, projectID = '') {
        await this.#request('set_recording', {name, enabled, project_id: projectID});
    }

    async snapshot(name, projectID = '') {
        return (await this.#request('snapshot', {name, project_id: projectID})).snapshot_url;
    }

    async listStreams(projectID = '') {
        return (await this.#request('list_streams', {project_id: projectID})).streams.streams;
    }

    pull(pull) {
        return this.#create('pull', pull);
    }

    push(push) {
        return this.#create('push', push);
    }
}
