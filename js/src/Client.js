import ObjectExtend from "./ObjectExtend.js";
import {ProjectError} from "./ProjectError.js";
import {encodeData} from "./Data.js";

const MAX_NAME = 255;
const MAX_SDP = 64 * 1024;
const MAX_CANDIDATE = 2048;
const MAX_CODECS = 8;
const MAX_RESUME = 64;
const MAX_CUSTOM = 8 * 1024;
const PLAY_TRANSPORT_LIST = ['webrtc', 'hls'];

export class Client extends ObjectExtend {
    #project;
    #socket;
    #user;
    #destroying = false;
    #mediaObjectMap = new Map();

    constructor(project, socket, user) {
        super();
        this.#project = project;
        this.#socket = socket;
        this.#user = user;
    }

    toString() {
        return `Client(${this.getID()} ${this.getIP()})`;
    }

    // программа браузера из заголовков сокета
    getUserAgent() {
        return String(this.#socket.getReqHeaders?.()['user-agent'] ?? '').slice(0, 512);
    }

    getID() {
        return this.#socket.getID();
    }

    getUser() {
        return this.#user;
    }

    getUserID() {
        return String(this.#user?.ID ?? '');
    }

    getIP() {
        return this.#socket.getIP();
    }

    getQuery() {
        return this.#socket.getQuery();
    }

    getOrigin() {
        return this.#socket.getOrigin();
    }

    getMediaObject(ID) {
        return this.#mediaObjectMap.get(ID) ?? null;
    }

    setMediaObject(mediaObject) {
        this.#mediaObjectMap.set(mediaObject.getID(), mediaObject);
    }

    deleteMediaObject(ID) {
        this.#mediaObjectMap.delete(ID);
    }

    getMediaObjectList() {
        return [...this.#mediaObjectMap.values()];
    }

    disconnect(reason = 'disconnect') {
        return this.destroy(reason);
    }

    async destroy(destroyMessage) {
        if (this.#destroying) {
            return this;
        }
        this.#destroying = true;
        const mediaApp = this.#project.getMediaApp();
        for (const mediaObject of this.getMediaObjectList()) {
            mediaApp.closeMediaObject(mediaObject, null, false);
        }
        if (!this.#socket.isDestroy()) {
            this.#socket.destroy(destroyMessage);
        }
        return super.destroy(destroyMessage);
    }

    async dispatch(xSocketData) {
        let result = {};
        let error = null;
        try {
            result = (await this.route(xSocketData)) ?? {};
        } catch (e) {
            const projectError = ProjectError.from(e);
            if (projectError.name === 'INTERNAL') {
                this.#project.log('error', `${this}: ${xSocketData.getType()}: ${e?.stack ?? e}`);
            }
            error = projectError.toPublic();
        }
        if (xSocketData.getTTL()) {
            xSocketData.response(error ? {error} : result, error ? error.name : false).catch(() => {});
        }
    }

    route(xSocketData) {
        const data = xSocketData.getData();
        switch (xSocketData.getType()) {
            case 'media.publish':
                return this.xSocket_media_publish(data);
            case 'media.play':
                return this.xSocket_media_play(data);
            case 'media.renegotiate':
                return this.xSocket_media_renegotiate(data);
            case 'media.signal':
                return this.xSocket_media_signal(data);
            case 'media.close':
                return this.xSocket_media_close(data);
            case 'media.resume':
                return this.xSocket_media_resume(data);
            case 'media.turn':
                return this.xSocket_media_turn();
            default:
                return this.#project.callMessageHandler(xSocketData.getType(), this, data);
        }
    }

    async xSocket_media_publish(data) {
        const offer = this.#offer(data.offer);
        const {name, data: value} = await this.#allow('publish', data.name, {custom: this.#custom(data.custom)});
        const created = await this.#project.getCoreLink().publish({
            client_id: this.getID(),
            user_id: this.getUserID(),
            name,
            offer,
            client_address: this.getIP(),
            user_agent: this.getUserAgent(),
            data: encodeData(value),
            turn_username: this.#turnUsername(data.turn),
        });
        return this.#add(created, name, 'publish', value).getInfo();
    }

    async xSocket_media_play(data) {
        const transport = this.#transport(data.transport);
        const offer = transport === 'webrtc' ? this.#offer(data.offer) : null;
        const projectID = data.projectID ?? '';
        if (typeof projectID !== 'string' || projectID.length > MAX_NAME) {
            throw new ProjectError('BAD_REQUEST');
        }
        const {name, data: value} = await this.#allow('play', data.name, {projectID, transport, custom: this.#custom(data.custom)});
        const created = await this.#project.getCoreLink().play({
            project_id: projectID,
            client_id: this.getID(),
            user_id: this.getUserID(),
            name,
            offer,
            client_address: this.getIP(),
            user_agent: this.getUserAgent(),
            preferred_codecs: this.#codecs(data.codecs),
            data: encodeData(value),
            transport: `TRANSPORT_${transport.toUpperCase()}`,
            turn_username: this.#turnUsername(data.turn),
        });
        return this.#add(created, name, 'play', value, transport).getInfo();
    }

    async xSocket_media_renegotiate(data) {
        const mediaObject = this.#own(data.ID);
        const isHLS = mediaObject.getTransport() === 'hls';
        const created = await this.#project.getCoreLink().renegotiate({
            media_id: mediaObject.getID(),
            offer: isHLS ? null : this.#offer(data.offer),
            preferred_codecs: this.#codecs(data.codecs),
            turn_username: this.#turnUsername(data.turn),
        });
        if (isHLS) {
            mediaObject.setPlayURL(created.play_url);
        }
        return mediaObject.getInfo();
    }

    // ICE-серверы для одного RTCPeerConnection; логин TURN одноразовый
    async xSocket_media_turn() {
        const turn = await this.#project.getCoreLink().issueTurn(this.getID());
        const iceServerList = [];
        if (turn.stun_urls?.length) {
            iceServerList.push({urls: turn.stun_urls});
        }
        if (turn.turn_urls?.length && turn.username) {
            iceServerList.push({urls: turn.turn_urls, username: turn.username, credential: turn.credential});
        }
        return {iceServerList, turn: turn.username ?? ''};
    }

    #turnUsername(value) {
        return typeof value === 'string' && /^[\w.:-]{1,64}$/.test(value) ? value : '';
    }

    xSocket_media_signal(data) {
        const mediaObject = this.#own(data.ID);
        const signal = {media_id: mediaObject.getID()};
        if (data.candidate && typeof data.candidate === 'object') {
            const candidate = String(data.candidate.candidate ?? '');
            if (candidate.length > MAX_CANDIDATE) {
                throw new ProjectError('BAD_REQUEST');
            }
            signal.candidate = {candidate, sdp_mline_index: Math.max(0, Number(data.candidate.sdpMLineIndex) | 0)};
        } else if (data.description && typeof data.description === 'object') {
            signal.description = this.#offer(data.description, true);
        } else {
            throw new ProjectError('BAD_REQUEST');
        }
        this.#project.getCoreLink().signal(signal);
    }

    async xSocket_media_close(data) {
        await this.#project.getMediaApp().closeMediaObject(this.#own(data.ID), null, false);
    }

    async xSocket_media_resume(data) {
        if (!Array.isArray(data.IDList) || data.IDList.length > MAX_RESUME || !data.IDList.every(ID => typeof ID === 'string')) {
            throw new ProjectError('BAD_REQUEST');
        }
        await this.#project.getCoreLink().synced();
        const resumed = [];
        const closed = [];
        for (const ID of new Set(data.IDList)) {
            try {
                resumed.push((await this.#resume(ID)).getInfo());
            } catch (e) {
                closed.push({ID, reason: ProjectError.from(e).toPublic()});
            }
        }
        return {resumed, closed};
    }

    #push(type, data) {
        if (!this.#socket.isDestroy()) {
            this.#socket.send(type, data, 0).catch(() => {});
        }
    }

    notify(event, data = {}) {
        this.#push('app.message', {event: String(event), data});
    }

    lost() {
        this.#push('session.lost', {reason: new ProjectError('SERVICE_UNAVAILABLE').toPublic()});
        setTimeout(() => this.disconnect('SERVICE_UNAVAILABLE'), 200).unref();
    }

    sendSessionReady() {
        // браузер смотрит HLS по ссылке на вход ядра со своими параметрами сокета
        this.#push('session.ready', {ID: this.getID(), hls: this.#project.getHlsEntry()});
    }

    sendSignal(mediaObject, signal) {
        const data = {ID: mediaObject.getID()};
        if (signal.candidate) {
            data.candidate = {candidate: signal.candidate.candidate, sdpMLineIndex: signal.candidate.sdp_mline_index};
        } else if (signal.description) {
            data.description = {type: signal.description.type, sdp: signal.description.sdp};
        } else {
            return;
        }
        this.#push('media.signal', data);
    }

    sendStatus(mediaObject, reason = null) {
        this.#push('media.status', {...mediaObject.getInfo(), reason: reason?.toPublic() ?? null});
    }

    sendStat(mediaObject) {
        this.#push('media.stat', mediaObject.getLastStat());
    }

    sendClosed(mediaObject, reason = null) {
        this.#push('media.closed', {ID: mediaObject.getID(), reason: reason?.toPublic() ?? null});
    }

    #own(ID) {
        const mediaObject = typeof ID === 'string' ? this.getMediaObject(ID) : null;
        if (!mediaObject) {
            throw new ProjectError('MEDIA_NOT_FOUND');
        }
        return mediaObject;
    }

    #offer(offer, answerAllowed = false) {
        if (!offer || typeof offer !== 'object' || typeof offer.sdp !== 'string' || !offer.sdp || offer.sdp.length > MAX_SDP) {
            throw new ProjectError('BAD_REQUEST');
        }
        const type = String(offer.type ?? 'offer');
        if (!(answerAllowed ? ['offer', 'answer'] : ['offer']).includes(type)) {
            throw new ProjectError('BAD_REQUEST');
        }
        return {type, sdp: offer.sdp};
    }

    #transport(transport) {
        if (transport === undefined || transport === null || transport === '') {
            return 'webrtc';
        }
        if (!PLAY_TRANSPORT_LIST.includes(transport)) {
            throw new ProjectError('BAD_REQUEST');
        }
        return transport;
    }

    #codecs(codecs) {
        if (!Array.isArray(codecs)) {
            return [];
        }
        return codecs.slice(0, MAX_CODECS).map(codec => String(codec).slice(0, 32));
    }

    #custom(custom) {
        if (custom === undefined || custom === null) {
            return {};
        }
        if (typeof custom !== 'object' || Array.isArray(custom) || JSON.stringify(custom).length > MAX_CUSTOM) {
            throw new ProjectError('BAD_REQUEST');
        }
        return custom;
    }

    async #allow(hook, name, extra = {}) {
        if (typeof name !== 'string' || !name || name.length > MAX_NAME) {
            throw new ProjectError('BAD_REQUEST');
        }
        const allowed = await this.#project.callHook(hook, this, {name, ...extra});
        const result = {name, data: this.#user?.data};
        if (typeof allowed === 'string') {
            result.name = allowed;
        } else if (typeof allowed === 'object') {
            result.name = allowed.name ?? name;
            if ('data' in allowed) {
                result.data = allowed.data;
            }
        } else if (allowed !== true) {
            throw new ProjectError('FORBIDDEN');
        }
        if (typeof result.name !== 'string' || !result.name || result.name.length > MAX_NAME) {
            throw new ProjectError('FORBIDDEN');
        }
        return result;
    }

    async #resume(ID) {
        const mediaApp = this.#project.getMediaApp();
        const mediaObject = mediaApp.getMediaObject(ID);
        if (!mediaObject || !mediaApp.isWaitingResume(ID)) {
            throw new ProjectError('MEDIA_NOT_FOUND');
        }
        await this.#project.callHook('resume', this, {
            ID,
            name: mediaObject.getName(),
            direction: mediaObject.getDirection(),
            userID: mediaObject.getUserID(),
            data: mediaObject.getData(),
        });
        if (mediaApp.claimMediaObject(ID) !== mediaObject) {
            throw new ProjectError('MEDIA_NOT_FOUND');
        }
        mediaObject.setClient(this);
        this.#project.log('debug', `${this}: resumed ${mediaObject}`);
        return mediaObject;
    }

    #add(created, name, direction, data, transport = 'webrtc') {
        const mediaObject = this.#project.getMediaApp().addMediaObject({
            ID: created.media_id,
            sessionID: created.session_id,
            name,
            direction,
            transport,
            userID: this.getUserID(),
            data,
            playURL: created.play_url ?? '',
            clientAddress: this.getIP(),
            userAgent: this.getUserAgent(),
        }, this);
        this.#project.log('debug', `${this}: ${direction} ${name} -> ${mediaObject.getID()}`);
        return mediaObject;
    }
}
