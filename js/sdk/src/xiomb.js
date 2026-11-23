import xSocket from "xsocket";
import {xiombEmitter} from "./xiombEmitter.js";
import {xiombError} from "./xiombError.js";
import {xiombPlayer} from "./xiombPlayer.js";
import {xiombSession, SERVICE_CODEC_LIST} from "./xiombSession.js";
import {xiombHlsSession} from "./xiombHlsSession.js";
import {xiombObject} from "./xiombObject.js";

const REQUEST_TTL = 20000;
const EARLY_MESSAGE_TTL = 10000;
const MEDIA_TYPE_LIST = ['media.signal', 'media.status', 'media.closed', 'media.stat'];
const DEFAULT_STUN_URL = 'stun:stun.xiomb.com:3478';
const TRANSPORT_NAME_MAP = {webrtc: 'WebRTC', hls: 'HLS'};

export class xiomb extends xiombEmitter {
    #config;
    #urlList;
    #query;
    #hlsEntry = null;
    #iceServerList;
    #params;
    #Hls;
    #hlsConfig;
    #xSocket;
    #xSocketClient = null;
    #xSocketObject = null;
    #ready = false;
    #connected = false;
    #sessionID = '';
    #mediaSessionMap = {};
    #earlyMessageMap = {};
    #lostStatusMap = {};
    #messageMap = {};
    // чем смотреть: порядок - приоритет по умолчанию, проверка поддержки браузером
    #transportCheckMap = {
        webrtc: () => typeof window.RTCPeerConnection === 'function',
        hls: () => {
            const Hls = this.getHls();
            if (Hls && typeof Hls.isSupported === 'function' && Hls.isSupported()) {
                return true;
            }
            const videoEl = document.createElement('video');
            return !!(videoEl.canPlayType && videoEl.canPlayType('application/vnd.apple.mpegurl'));
        },
    };

    constructor(config) {
        super();
        this.#config = config || {};
        this.#urlList = Array.isArray(this.#config.url) ? this.#config.url : [this.#config.url];
        this.setMessageList(this.#config.messageList);
        this.#params = {video: true, audio: true, ...this.#config.params};
        this.#query = this.#config.query || {};
        this.#iceServerList = this.#config.iceServerList || null;
        this.#Hls = this.#config.Hls || null;
        this.#hlsConfig = this.#config.hlsConfig || {};
        this.#xSocket = this.#config.xSocket || xSocket;
        if (typeof this.#xSocket !== 'function') {
            throw new xiombError('INTERNAL', 'xSocket not found');
        }
        if (window.addEventListener) {
            window.addEventListener('pagehide', () => {
                for (const mediaSession of this.getMediaSessionList()) {
                    this.notify('media.close', {ID: mediaSession.getID()});
                }
            });
        }
    }

    #closeMediaSessionList(reason) {
        const mediaSessionList = this.getMediaSessionList();
        for (const mediaSession of mediaSessionList) {
            mediaSession.onClosed({reason});
        }
        return mediaSessionList;
    }

    #deliver(mediaSession, type, data) {
        switch (type) {
            case 'media.signal':
                return mediaSession.onSignal(data);
            case 'media.status':
                return mediaSession.onStatus(data);
            case 'media.closed':
                return mediaSession.onClosed(data);
            case 'media.stat':
                return mediaSession.onStat(data);
        }
    }

    async #resume() {
        const mediaSessionList = this.getMediaSessionList();
        if (!mediaSessionList.length) {
            return;
        }
        let resumeResult;
        try {
            resumeResult = await this.request('media.resume', {IDList: mediaSessionList.map(mediaSession => mediaSession.getID())});
        } catch (e) {
            this.#closeMediaSessionList({name: 'SESSION_RESET', message: 'Session reset'});
            this.emit('reset');
            return;
        }
        const resumedList = resumeResult.resumed || [];
        const closedList = resumeResult.closed || [];
        for (const resumed of resumedList) {
            const mediaSession = this.getMediaSession(resumed.ID);
            if (mediaSession) {
                mediaSession.onStatus({...resumed, reason: null});
            }
        }
        for (const closed of closedList) {
            const mediaSession = this.getMediaSession(closed.ID);
            if (mediaSession) {
                mediaSession.onClosed({reason: closed.reason});
            }
        }
        this.emit('resume', {resumed: resumedList.length, closed: closedList.length});
    }

    #setReconnectStatus() {
        for (const mediaSession of this.getMediaSessionList()) {
            const ID = mediaSession.getID();
            if (!this.#lostStatusMap.hasOwnProperty(ID)) {
                this.#lostStatusMap[ID] = mediaSession.getStatus();
            }
            mediaSession.onStatus({status: 'reconnect', renegotiate: false, reason: null});
        }
    }

    #restoreStatus() {
        const lostStatusMap = this.#lostStatusMap;
        this.#lostStatusMap = {};
        for (const ID of Object.keys(lostStatusMap)) {
            const mediaSession = this.getMediaSession(ID);
            if (mediaSession && mediaSession.getStatus() === 'reconnect') {
                mediaSession.onStatus({status: lostStatusMap[ID], renegotiate: false, reason: null});
            }
        }
    }

    #onReconnect(xSocketObject) {
        this.#xSocketObject = xSocketObject;
        if (!this.#ready || this.#connected) {
            return;
        }
        this.#connected = true;
        this.#restoreStatus();
        this.emit('reconnect');
        this.emit('sessionReady');
    }

    #onDisconnect(reason) {
        const connected = this.#connected;
        this.#connected = false;
        this.#xSocketObject = null;
        if (!this.#ready) {
            const message = String(reason || 'NOT_CONNECTED');
            this.emit('connectFail', new xiombError(/^[A-Z_]+$/.test(message) ? message : 'NOT_CONNECTED', message));
            return;
        }
        if (connected) {
            this.#setReconnectStatus();
            this.emit('disconnect', reason);
        }
    }

    #onSessionReady(data) {
        const sessionID = data && data.ID ? data.ID : '';
        this.#hlsEntry = data && data.hls && data.hls.url ? data.hls : null;
        this.#connected = true;
        if (!this.#ready) {
            this.#ready = true;
            this.#sessionID = sessionID;
            this.emit('connect');
            this.emit('sessionReady');
            return;
        }
        if (sessionID !== this.#sessionID) {
            this.#sessionID = sessionID;
            this.#lostStatusMap = {};
            this.#resume();
        } else {
            this.#restoreStatus();
        }
        this.emit('reconnect');
        this.emit('sessionReady');
    }

    #onData(xSocketData) {
        const type = xSocketData.getType();
        const data = xSocketData.getData();
        if (type === 'session.ready') {
            return this.#onSessionReady(data);
        }
        if (type === 'app.message') {
            return this.emit('message', data ? data.event : undefined, data ? data.data : undefined);
        }
        if (type === 'session.lost') {
            const reason = data && data.reason ? data.reason : null;
            this.#closeMediaSessionList(reason);
            return this.emit('lost', reason);
        }
        if (MEDIA_TYPE_LIST.indexOf(type) === -1 || !data || typeof data.ID !== 'string') {
            return;
        }
        const mediaSession = this.getMediaSession(data.ID);
        if (mediaSession) {
            return this.#deliver(mediaSession, type, data);
        }
        if (!this.#earlyMessageMap[data.ID]) {
            this.#earlyMessageMap[data.ID] = {
                messageList: [],
                timer: setTimeout(() => {
                    delete this.#earlyMessageMap[data.ID];
                }, EARLY_MESSAGE_TTL),
            };
        }
        this.#earlyMessageMap[data.ID].messageList.push({type, data});
    }

    #createClient() {
        this.#xSocketClient = new this.#xSocket(this.#urlList, {...this.#query});
        this.#xSocketClient.on('connect', xSocketObject => {
            this.#xSocketObject = xSocketObject;
        });
        this.#xSocketClient.on('reconnect', xSocketObject => this.#onReconnect(xSocketObject));
        this.#xSocketClient.on('ws|disconnect', reason => this.#onDisconnect(reason));
        this.#xSocketClient.on('data', xSocketData => this.#onData(xSocketData));
        this.#xSocketClient.on('destroy', (xSocketObject, reason) => this.#onDisconnect(reason));
    }

    getConfig() {
        return this.#config;
    }

    getSessionID() {
        return this.#sessionID;
    }

    // для каждого RTCPeerConnection свой одноразовый логин TURN от сервера
    async getIceServers() {
        if (this.#iceServerList) {
            return {iceServerList: this.#iceServerList, turn: ''};
        }
        try {
            const result = await this.request('media.turn', {});
            if (result && Array.isArray(result.iceServerList) && result.iceServerList.length) {
                return {iceServerList: result.iceServerList, turn: result.turn || ''};
            }
        } catch (e) {
            console.warn('[xiomb] TURN unavailable:', e && e.name);
        }
        return {iceServerList: [{urls: DEFAULT_STUN_URL}], turn: ''};
    }

    isConnected() {
        return this.#connected && !!this.#xSocketObject;
    }

    connect() {
        return new Promise((resolve, reject) => {
            if (this.isConnected()) {
                return resolve(this);
            }
            const onConnect = () => {
                this.off('connectFail', onFail);
                resolve(this);
            };
            const onFail = error => {
                this.off('sessionReady', onConnect);
                reject(error);
            };
            this.once('sessionReady', onConnect);
            this.once('connectFail', onFail);
            if (!this.#xSocketClient) {
                this.#createClient();
            }
        });
    }

    setMessageList(messageList) {
        this.#messageMap = {...this.#messageMap, ...messageList};
    }

    getMessage(error) {
        const isObject = typeof error === 'object' && !!error;
        const keyList = isObject ? [error.name, error.message] : [error];
        for (const key of keyList) {
            if (key && this.#messageMap.hasOwnProperty(String(key))) {
                return this.#messageMap[String(key)];
            }
        }
        if (this.#messageMap.hasOwnProperty('default')) {
            return this.#messageMap.default;
        }
        return isObject ? (error.message || error.name || '') : String(error || '');
    }

    getCodecList(isPublish) {
        const codecList = {video: [], audio: []};
        const capabilitySource = isPublish ? window.RTCRtpSender : window.RTCRtpReceiver;
        if (!capabilitySource || typeof capabilitySource.getCapabilities !== 'function') {
            return codecList;
        }
        for (const kind of Object.keys(codecList)) {
            const capabilities = capabilitySource.getCapabilities(kind);
            for (const item of capabilities && capabilities.codecs ? capabilities.codecs : []) {
                const name = String(item.mimeType || '').split('/')[1] || '';
                if (name && SERVICE_CODEC_LIST.indexOf(name.toUpperCase()) === -1 && codecList[kind].indexOf(name) === -1) {
                    codecList[kind].push(name);
                }
            }
        }
        return codecList;
    }

    getParams() {
        return this.#params;
    }

    getHls() {
        return this.#Hls || window.Hls || null;
    }

    getHlsConfig() {
        return this.#hlsConfig;
    }

    isTransportSupported(transport) {
        return this.#transportCheckMap.hasOwnProperty(transport) && this.#transportCheckMap[transport]();
    }

    getTransportList() {
        return Object.keys(this.#transportCheckMap).filter(transport => this.isTransportSupported(transport));
    }

    selectTransport(transport) {
        const transportList = (Array.isArray(transport) ? transport : [transport || 'webrtc']).map(item => String(item).toLowerCase());
        for (let i = 0; i < transportList.length; i++) {
            const name = transportList[i];
            if (!this.#transportCheckMap.hasOwnProperty(name)) {
                console.error(`[xiomb] Unknown transport: ${name}`);
                continue;
            }
            if (this.isTransportSupported(name)) {
                return name;
            }
            if (name === 'webrtc' && transportList.indexOf('hls') === -1) {
                console.error('[xiomb] WebRTC is not supported by this browser, switching to HLS');
                transportList.push('hls');
            } else {
                console.error(`[xiomb] ${TRANSPORT_NAME_MAP[name]} is not supported by this browser`);
            }
        }
        throw new xiombError('NOT_SUPPORTED', 'Not supported');
    }

    createPlayer(isPublish, targetEl, options) {
        return new xiombPlayer(isPublish, targetEl || null, {...options, params: (options && options.params) || this.#params});
    }

    // вход HLS ядра: {url, projectID} или null
    getHlsEntry() {
        return this.#hlsEntry;
    }

    // параметры сокета: те же уходят в ссылку HLS для хука auth
    getQuery() {
        return {...this.#query};
    }

    createMediaSession(direction, streamName, options) {
        if (direction === 'play' && options && options.transport === 'hls') {
            return new xiombHlsSession(this, streamName, options);
        }
        return new xiombSession(this, direction, streamName, options);
    }

    publish(streamName, options) {
        return new xiombObject(this, true, streamName, options || {});
    }

    play(streamName, options) {
        return new xiombObject(this, false, streamName, options || {});
    }

    getMediaSessionList() {
        return Object.keys(this.#mediaSessionMap).map(ID => this.#mediaSessionMap[ID]);
    }

    getMediaSession(ID) {
        return this.#mediaSessionMap.hasOwnProperty(ID) ? this.#mediaSessionMap[ID] : null;
    }

    addMediaSession(mediaSession) {
        const ID = mediaSession.getID();
        const earlyMessage = this.#earlyMessageMap[ID];
        this.#mediaSessionMap[ID] = mediaSession;
        delete this.#earlyMessageMap[ID];
        if (earlyMessage) {
            clearTimeout(earlyMessage.timer);
            for (const message of earlyMessage.messageList) {
                this.#deliver(mediaSession, message.type, message.data);
            }
        }
        this.emit('session', mediaSession);
    }

    deleteMediaSession(mediaSession) {
        delete this.#mediaSessionMap[mediaSession.getID()];
    }

    async request(type, data) {
        if (!this.#xSocketObject) {
            throw new xiombError('NOT_CONNECTED', 'Not connected');
        }
        let xSocketData;
        try {
            xSocketData = await this.#xSocketObject.sendReady(type, data, REQUEST_TTL);
        } catch (e) {
            throw new xiombError(e && e.message);
        }
        return xSocketData.getResData();
    }

    notify(type, data) {
        if (!this.#xSocketObject) {
            return;
        }
        const result = this.#xSocketObject.send(type, data, 0);
        if (result && typeof result.catch === 'function') {
            result.catch(() => {});
        }
    }
}
