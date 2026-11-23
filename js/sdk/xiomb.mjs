/*!
 * xiomb v0.1.4
 * Copyright (c) 2026 Jaxima LLC
 * @license MIT
 * @link https://github.com/Xiomb/xiomb
 */

class xiombEmitter {
    #listenerMap = {};

    #add(name, callback, once) {
        if (typeof name !== 'string' || typeof callback !== 'function') {
            return this;
        }
        if (!this.#listenerMap.hasOwnProperty(name)) {
            this.#listenerMap[name] = [];
        }
        this.#listenerMap[name].push({callback, once});
        return this;
    }

    on(name, callback) {
        return this.#add(name, callback, false);
    }

    once(name, callback) {
        return this.#add(name, callback, true);
    }

    off(name, callback) {
        if (!this.#listenerMap.hasOwnProperty(name)) {
            return this;
        }
        const listenerList = this.#listenerMap[name].filter(listener => listener.callback !== callback);
        if (listenerList.length) {
            this.#listenerMap[name] = listenerList;
        } else {
            delete this.#listenerMap[name];
        }
        return this;
    }

    emit(name, ...args) {
        if (!this.#listenerMap.hasOwnProperty(name)) {
            return this;
        }
        for (const listener of this.#listenerMap[name].slice()) {
            if (listener.once) {
                this.off(name, listener.callback);
            }
            try {
                listener.callback.apply(this, args);
            } catch (e) {
                console.error('[xiomb]', e);
            }
        }
        return this;
    }
}

class xiombError extends Error {
    constructor(name, message, cause) {
        const errorName = name || 'INTERNAL';
        super(message || errorName);
        this.name = errorName;
        this.cause = cause || null;
    }
}

const getValue = value => value === undefined ? null : value;

class xiombStat {
    #isPublish;
    #lastByteMap = {};

    constructor(isPublish) {
        this.#isPublish = isPublish;
    }

    #createTrackStat(report, item) {
        const byteCount = (this.#isPublish ? item.bytesSent : item.bytesReceived) || 0;
        const lastByte = this.#lastByteMap[item.id];
        const seconds = lastByte ? (item.timestamp - lastByte.timestamp) / 1000 : 0;
        const codec = item.codecId ? report.get(item.codecId) : null;
        this.#lastByteMap[item.id] = {byteCount, timestamp: item.timestamp};
        return {
            codec: codec && codec.mimeType ? codec.mimeType.split('/')[1] : null,
            bitrate: seconds > 0 ? Math.round((byteCount - lastByte.byteCount) * 8 / seconds) : 0,
            byteCount,
            packetCount: getValue(this.#isPublish ? item.packetsSent : item.packetsReceived),
            packetLostCount: getValue(item.packetsLost),
            jitter: getValue(item.jitter),
            width: getValue(item.frameWidth),
            height: getValue(item.frameHeight),
            fps: getValue(item.framesPerSecond),
            frameDroppedCount: getValue(item.framesDropped),
        };
    }

    reset() {
        this.#lastByteMap = {};
    }

    async collect(peerConnection) {
        const stat = {timestamp: Date.now(), video: null, audio: null, rtt: null, remotePacketLostList: {}};
        if (!peerConnection) {
            return stat;
        }
        const report = await peerConnection.getStats();
        const rtpType = this.#isPublish ? 'outbound-rtp' : 'inbound-rtp';
        report.forEach(item => {
            const kind = item.kind || item.mediaType;
            const isMediaKind = kind === 'video' || kind === 'audio';
            if (item.type === rtpType && !item.isRemote) {
                if (isMediaKind) {
                    stat[kind] = this.#createTrackStat(report, item);
                }
            } else if (item.type === 'candidate-pair' && item.nominated && item.state === 'succeeded') {
                stat.rtt = getValue(item.currentRoundTripTime);
            } else if (this.#isPublish && item.type === 'remote-inbound-rtp' && isMediaKind) {
                stat.remotePacketLostList[kind] = getValue(item.packetsLost);
            }
        });
        return stat;
    }
}

const ICON_PATH_MAP = {
    mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z',
    cam: 'M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z',
    sound: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z',
    settings: 'M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54a7.4 7.4 0 0 0-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58a5.8 5.8 0 0 0 0 1.88l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54a7 7 0 0 0 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z',
    fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
};
const TEXT_MAP = {
    publishStart: 'Go live',
    publishStop: 'Stop',
    playStart: 'Play',
    playStop: 'Stop',
    preview: 'Preview',
    live: 'Live',
    devices: 'Devices',
    camera: 'Camera',
    microphone: 'Microphone',
    done: 'Done',
};
const ACTIVE_STATUS_LIST = ['connect', 'publish', 'play', 'reconnect'];
const IDLE_TIMEOUT = 3000;
const HLS_NETWORK_ERROR_MAX = 3;

const createEl = (tagName, className, parentEl) => {
    const el = document.createElement(tagName);
    if (className) {
        el.className = className;
    }
    if (parentEl) {
        parentEl.appendChild(el);
    }
    return el;
};

const createButtonEl = (className, iconName, title, parentEl) => {
    const el = createEl('button', `xiombPlayer_button ${className}`, parentEl);
    el.type = 'button';
    el.title = title || '';
    el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_PATH_MAP[iconName]}"/><line class="xiombPlayer_slash" x1="4" y1="4" x2="20" y2="20"/></svg>`;
    return el;
};

const onClick = (el, callback) => {
    el.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        callback(e);
    });
};

const getDefaultConstraints = () => ({audio: true, video: {width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30}}});

const createMediaError = e => {
    switch (e && e.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
        case 'SecurityError':
            return new xiombError('PERMISSION_DENIED', 'Permission denied', e);
        case 'NotFoundError':
        case 'DevicesNotFoundError':
            return new xiombError('DEVICE_NOT_FOUND', 'Device not found', e);
        case 'NotReadableError':
        case 'TrackStartError':
        case 'AbortError':
            return new xiombError('DEVICE_BUSY', 'Device busy', e);
        case 'OverconstrainedError':
        case 'ConstraintNotSatisfiedError':
            return new xiombError('CONSTRAINT_NOT_SATISFIED', `Constraint not satisfied: ${e.constraint || ''}`, e);
        case 'TypeError':
            return new xiombError('INVALID_CONSTRAINTS', 'Invalid constraints', e);
        default:
            return new xiombError('MEDIA_ERROR', (e && e.message) || 'Media error', e);
    }
};

const isConstraintError = e => !!e && (e.name === 'OverconstrainedError' || e.name === 'ConstraintNotSatisfiedError');

const getSimpleConstraints = constraints => {
    const simpleConstraints = {};
    for (const kind of Object.keys(constraints)) {
        const source = constraints[kind];
        simpleConstraints[kind] = typeof source === 'object' && source ? (source.deviceId ? {deviceId: source.deviceId} : true) : source;
    }
    return simpleConstraints;
};

const requestUserMedia = async (mediaDevices, constraints) => {
    try {
        return await mediaDevices.getUserMedia(constraints);
    } catch (e) {
        const simpleConstraints = getSimpleConstraints(constraints);
        if (isConstraintError(e) && JSON.stringify(simpleConstraints) !== JSON.stringify(constraints)) {
            return mediaDevices.getUserMedia(simpleConstraints);
        }
        throw e;
    }
};

const getTrackKind = kind => kind === 'videoinput' ? 'video' : 'audio';

class xiombPlayer extends xiombEmitter {
    #isPublish;
    #targetEl;
    #options;
    #textMap;
    #idleTimer = null;
    #constraints;
    #params;
    #rootEl;
    #videoEl;
    #titleEl;
    #messageEl;
    #actionEl;
    #muteEl;
    #videoMuteEl;
    #videoInputEl;
    #audioInputEl;
    #mediaStream = null;
    #playURL = null;
    #hlsObject = null;
    #hlsNetworkErrorCount = 0;
    #deviceIDMap = {audioinput: '', videoinput: ''};
    #captured = false;
    #boundTrackList = [];
    #status = 'new';
    #muted = false;
    #videoMuted = false;
    #volume = 1;
    #destroyed = false;

    constructor(isPublish, targetEl, options) {
        super();
        this.#isPublish = !!isPublish;
        this.#options = options || {};
        this.#targetEl = targetEl && targetEl.jquery ? targetEl[0] : (targetEl || null);
        this.#params = this.#options.params || {audio: true, video: true};
        this.#constraints = this.#filterConstraints(this.#options.constraints || getDefaultConstraints());
        this.#textMap = {...TEXT_MAP, ...this.#options.textList};
        this.#createLayout();
        this.setTitle(this.#options.title || '');
        this.#render();
        this.#wake();
        if (this.#targetEl) {
            this.#targetEl.appendChild(this.#rootEl);
        }
        if (this.#isPublish && navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
            navigator.mediaDevices.addEventListener('devicechange', () => {
                if (!this.#destroyed && this.#mediaStream) {
                    this.updateDeviceList().catch(() => {});
                }
            });
        }
    }

    #isKindEnabled(kind) {
        return this.#params[kind] !== false;
    }

    #hasConstraint(kind) {
        return this.#isKindEnabled(kind) && !!this.#constraints[kind];
    }

    #filterConstraints(constraints) {
        const filteredConstraints = {};
        for (const key of Object.keys(constraints)) {
            if (this.#isKindEnabled(key)) {
                filteredConstraints[key] = constraints[key];
            }
        }
        return filteredConstraints;
    }

    #renderKindList() {
        this.#rootEl.setAttribute('data-audio', this.#isPublish ? this.#hasConstraint('audio') : this.#isKindEnabled('audio'));
        this.#rootEl.setAttribute('data-video', this.#isPublish ? this.#hasConstraint('video') : this.#isKindEnabled('video'));
    }

    #getTrackList() {
        return this.#mediaStream ? this.#mediaStream.getTracks() : [];
    }

    #getTrack(trackKind) {
        return this.#getTrackList().filter(track => track.kind === trackKind)[0];
    }

    #hasSource() {
        return !!this.#mediaStream || !!this.#playURL;
    }

    #destroyHls() {
        if (this.#hlsObject) {
            this.#hlsObject.destroy();
            this.#hlsObject = null;
        }
    }

    // hls.js через MSE, иначе родной HLS (Safari)
    #loadPlayURL(Hls, hlsConfig) {
        if (!Hls || typeof Hls.isSupported !== 'function' || !Hls.isSupported()) {
            this.#videoEl.src = this.#playURL;
            return;
        }
        const hlsObject = new Hls(hlsConfig || {});
        this.#hlsObject = hlsObject;
        this.#hlsNetworkErrorCount = 0;
        hlsObject.on(Hls.Events.LEVEL_LOADED, () => {
            this.#hlsNetworkErrorCount = 0;
        });
        hlsObject.on(Hls.Events.ERROR, (event, data) => {
            if (hlsObject !== this.#hlsObject || !data || !data.fatal) {
                return;
            }
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && ++this.#hlsNetworkErrorCount <= HLS_NETWORK_ERROR_MAX) {
                hlsObject.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                hlsObject.recoverMediaError();
            } else {
                this.emit('playError', new xiombError('PLAY_FAILED', data.details, data));
            }
        });
        hlsObject.loadSource(this.#playURL);
        hlsObject.attachMedia(this.#videoEl);
    }

    #isActiveStatus() {
        return ACTIVE_STATUS_LIST.indexOf(this.#status) !== -1;
    }

    #render() {
        const isActive = this.#isActiveStatus();
        this.#rootEl.setAttribute('data-status', this.#status);
        this.#rootEl.setAttribute('data-active', isActive);
        this.#rootEl.setAttribute('data-muted', this.#muted);
        this.#rootEl.setAttribute('data-video-muted', this.#videoMuted);
        this.#rootEl.setAttribute('data-stream', this.#hasSource());
        this.#actionEl.textContent = this.#textMap[(this.#isPublish ? 'publish' : 'play') + (isActive ? 'Stop' : 'Start')];
        this.#muteEl.setAttribute('data-off', this.#muted);
        this.#videoMuteEl.setAttribute('data-off', this.#videoMuted);
    }

    #applyTrackState() {
        if (!this.#isPublish || !this.#mediaStream) {
            return;
        }
        for (const track of this.#mediaStream.getAudioTracks()) {
            track.enabled = !this.#muted;
        }
        for (const track of this.#mediaStream.getVideoTracks()) {
            track.enabled = !this.#videoMuted;
        }
    }

    #bindTrackEnded(mediaStream) {
        for (const track of mediaStream.getTracks()) {
            if (this.#boundTrackList.indexOf(track) !== -1) {
                continue;
            }
            this.#boundTrackList.push(track);
            track.addEventListener('ended', () => {
                if (this.#getTrackList().indexOf(track) !== -1) {
                    this.emit('ended', track.kind);
                }
            });
        }
    }

    async #getUserMedia(constraints) {
        const mediaDevices = navigator.mediaDevices;
        if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
            throw window.isSecureContext === false ? new xiombError('INSECURE_CONTEXT', 'Insecure context') : new xiombError('NOT_SUPPORTED', 'Not supported');
        }
        try {
            return await requestUserMedia(mediaDevices, constraints);
        } catch (e) {
            const error = createMediaError(e);
            this.updateDeviceList().catch(() => {});
            this.emit('error', error);
            throw error;
        }
    }

    #getKindConstraints(kind, deviceID) {
        const source = this.#constraints[kind];
        const constraints = typeof source === 'object' && source ? {...source} : {};
        if (deviceID) {
            constraints.deviceId = {exact: deviceID};
        }
        return constraints;
    }

    #getCaptureConstraints() {
        const constraints = {};
        const kindMap = {audio: 'audioinput', video: 'videoinput'};
        for (const kind of Object.keys(kindMap)) {
            if (!this.#hasConstraint(kind)) {
                continue;
            }
            const deviceID = this.#deviceIDMap[kindMap[kind]];
            constraints[kind] = deviceID || typeof this.#constraints[kind] === 'object' ? this.#getKindConstraints(kind, deviceID) : this.#constraints[kind];
        }
        return constraints;
    }

    #getCurrentDeviceID(trackKind) {
        const track = this.#getTrack(trackKind);
        const settings = track && typeof track.getSettings === 'function' ? track.getSettings() : {};
        return settings.deviceId || '';
    }

    #fillDeviceSelect(selectEl, deviceList, kind, label) {
        const currentDeviceID = this.#getCurrentDeviceID(getTrackKind(kind)) || this.#deviceIDMap[kind];
        const itemList = deviceList.filter(device => device.kind === kind && device.deviceId);
        selectEl.innerHTML = '';
        itemList.forEach((item, i) => {
            const optionEl = createEl('option', '', selectEl);
            optionEl.value = item.deviceId;
            optionEl.textContent = item.label || `${label} ${i + 1}`;
            optionEl.selected = item.deviceId === currentDeviceID;
        });
        selectEl.disabled = itemList.length < 2;
    }

    #toggleFullscreen = () => {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            return;
        }
        const request = this.#rootEl.requestFullscreen || this.#rootEl.webkitRequestFullscreen;
        if (request) {
            request.call(this.#rootEl);
        }
    };

    #wake = () => {
        this.#rootEl.setAttribute('data-idle', false);
        clearTimeout(this.#idleTimer);
        this.#idleTimer = setTimeout(() => {
            if (this.#rootEl.getAttribute('data-settings') === 'true') {
                return this.#wake();
            }
            this.#rootEl.setAttribute('data-idle', true);
        }, IDLE_TIMEOUT);
    };

    #createLayout() {
        const rootEl = this.#rootEl = createEl('div', 'xiombPlayer');
        rootEl.setAttribute('data-publish', this.#isPublish);
        rootEl.setAttribute('data-settings', false);
        this.#renderKindList();

        const videoEl = this.#videoEl = createEl('video', 'xiombPlayer_video', createEl('div', 'xiombPlayer_screen', rootEl));
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.setAttribute('playsinline', '');
        videoEl.muted = this.#isPublish || !this.#isKindEnabled('audio');
        videoEl.addEventListener('error', () => {
            if (this.#playURL && !this.#hlsObject) {
                this.emit('playError', new xiombError('PLAY_FAILED', 'Play failed'));
            }
        });

        const topEl = createEl('div', 'xiombPlayer_top', rootEl);
        const badgeEl = createEl('span', 'xiombPlayer_badge', topEl);
        createEl('span', 'xiombPlayer_badgePreview', badgeEl).textContent = this.#textMap.preview;
        createEl('span', 'xiombPlayer_badgeLive', badgeEl).textContent = this.#textMap.live;
        this.#titleEl = createEl('span', 'xiombPlayer_title', topEl);
        onClick(createButtonEl('xiombPlayer_close', 'close', 'Close', topEl), () => this.destroy());

        const centerEl = createEl('div', 'xiombPlayer_center', rootEl);
        createEl('span', 'xiombPlayer_spinner', centerEl);
        this.#messageEl = createEl('span', 'xiombPlayer_message', centerEl);
        this.#actionEl = createEl('button', 'xiombPlayer_action', centerEl);
        this.#actionEl.type = 'button';
        onClick(this.#actionEl, () => this.emit('request', this.#isActiveStatus() ? 'stop' : 'start'));

        const barEl = createEl('div', 'xiombPlayer_bar', rootEl);
        this.#muteEl = createButtonEl('xiombPlayer_mute', this.#isPublish ? 'mic' : 'sound', this.#isPublish ? 'Microphone' : 'Sound', barEl);
        onClick(this.#muteEl, () => this.#muted ? this.unmute() : this.mute());
        this.#videoMuteEl = createButtonEl('xiombPlayer_videoMute', 'cam', 'Camera', barEl);
        onClick(this.#videoMuteEl, () => this.#videoMuted ? this.unmuteVideo() : this.muteVideo());
        createEl('span', 'xiombPlayer_space', barEl);
        onClick(createButtonEl('xiombPlayer_settingsButton', 'settings', this.#textMap.devices, barEl), () => this.toggleSettings());
        onClick(createButtonEl('xiombPlayer_fullscreen', 'fullscreen', 'Fullscreen', barEl), this.#toggleFullscreen);

        const settingsPanelEl = createEl('div', 'xiombPlayer_settings', rootEl);
        createEl('div', 'xiombPlayer_settingsTitle', settingsPanelEl).textContent = this.#textMap.devices;
        const videoLabelEl = createEl('label', 'xiombPlayer_field xiombPlayer_fieldVideo', settingsPanelEl);
        createEl('span', '', videoLabelEl).textContent = this.#textMap.camera;
        this.#videoInputEl = createEl('select', '', videoLabelEl);
        const audioLabelEl = createEl('label', 'xiombPlayer_field xiombPlayer_fieldAudio', settingsPanelEl);
        createEl('span', '', audioLabelEl).textContent = this.#textMap.microphone;
        this.#audioInputEl = createEl('select', '', audioLabelEl);
        const doneEl = createEl('button', 'xiombPlayer_settingsDone', settingsPanelEl);
        doneEl.type = 'button';
        doneEl.textContent = this.#textMap.done;
        onClick(doneEl, () => this.closeSettings());
        this.#videoInputEl.addEventListener('change', () => {
            this.setDevice('videoinput', this.#videoInputEl.value).catch(error => this.emit('deviceError', error));
        });
        this.#audioInputEl.addEventListener('change', () => {
            this.setDevice('audioinput', this.#audioInputEl.value).catch(error => this.emit('deviceError', error));
        });
        rootEl.addEventListener('dblclick', this.#toggleFullscreen);
        for (const eventName of ['mousemove', 'mouseenter', 'touchstart', 'click']) {
            rootEl.addEventListener(eventName, this.#wake);
        }
    }

    isPublish() {
        return this.#isPublish;
    }

    getElement() {
        return this.#rootEl;
    }

    getTargetElement() {
        return this.#targetEl;
    }

    getVideoElement() {
        return this.#videoEl;
    }

    getParams() {
        return this.#params;
    }

    getConstraints() {
        return this.#constraints;
    }

    setConstraints(constraints) {
        this.#constraints = this.#filterConstraints(constraints || getDefaultConstraints());
        this.#renderKindList();
    }

    getMediaStream() {
        return this.#mediaStream;
    }

    isCaptured() {
        return this.#captured;
    }

    isPlaying() {
        return this.#hasSource() && !this.#videoEl.paused;
    }

    isDestroyed() {
        return this.#destroyed;
    }

    getStatus() {
        return this.#status;
    }

    setStatus(status, message) {
        this.#status = status || 'new';
        this.setMessage(message || '');
        this.#render();
    }

    setMessage(message) {
        this.#messageEl.textContent = message || '';
        this.#rootEl.setAttribute('data-message', !!message);
    }

    setTitle(title) {
        this.#titleEl.textContent = title || '';
    }

    setText(key, text) {
        this.#textMap[key] = text;
        this.#render();
    }

    getPlayURL() {
        return this.#playURL;
    }

    setPlayURL(playURL, Hls, hlsConfig) {
        const nextPlayURL = playURL || null;
        if (this.#playURL === nextPlayURL) {
            return;
        }
        this.#destroyHls();
        if (nextPlayURL && this.#mediaStream) {
            this.setMediaStream(null);
        }
        this.#playURL = nextPlayURL;
        if (this.#playURL) {
            this.#videoEl.srcObject = null;
            this.#loadPlayURL(Hls, hlsConfig);
        } else {
            this.#videoEl.removeAttribute('src');
            this.#videoEl.load();
        }
        this.#render();
    }

    setMediaStream(mediaStream, captured) {
        if (this.#mediaStream === mediaStream) {
            return;
        }
        if (mediaStream && this.#playURL) {
            this.setPlayURL(null);
        }
        if (this.#captured) {
            const nextTrackList = mediaStream ? mediaStream.getTracks() : [];
            for (const track of this.#getTrackList()) {
                if (nextTrackList.indexOf(track) === -1) {
                    track.stop();
                }
            }
        }
        this.#mediaStream = mediaStream || null;
        this.#captured = !!mediaStream && !!captured;
        this.#videoEl.srcObject = this.#mediaStream;
        if (this.#mediaStream) {
            this.#applyTrackState();
            this.#bindTrackEnded(this.#mediaStream);
        }
        this.#render();
        this.emit('stream', this.#mediaStream);
    }

    async getUserMedia(constraints) {
        if (constraints) {
            this.setConstraints(constraints);
        }
        const mediaStream = await this.#getUserMedia(this.#getCaptureConstraints());
        this.setMediaStream(mediaStream, true);
        this.updateDeviceList().catch(() => {});
        await this.play();
        return mediaStream;
    }

    async setDevice(kind, deviceID) {
        const trackKind = getTrackKind(kind);
        if (!this.#hasConstraint(trackKind)) {
            throw new xiombError('INVALID_CONSTRAINTS', 'Invalid constraints');
        }
        this.#deviceIDMap[kind] = deviceID || '';
        if (!this.#mediaStream) {
            const mediaStream = await this.getUserMedia();
            this.emit('device', kind, deviceID);
            return mediaStream;
        }
        const deviceStream = await this.#getUserMedia({[trackKind]: this.#getKindConstraints(trackKind, deviceID)});
        const trackList = this.#getTrackList().filter(track => track.kind !== trackKind);
        this.setMediaStream(new MediaStream([...trackList, ...deviceStream.getTracks()]), true);
        this.updateDeviceList().catch(() => {});
        this.emit('device', kind, deviceID);
        return this.play();
    }

    getDeviceName(kind) {
        const track = this.#getTrack(getTrackKind(kind));
        return track ? track.label || '' : '';
    }

    getDeviceID(kind) {
        return this.#getCurrentDeviceID(getTrackKind(kind)) || this.#deviceIDMap[kind] || '';
    }

    async getDeviceList(kind) {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
            throw new xiombError('NOT_SUPPORTED', 'Not supported');
        }
        const deviceList = await navigator.mediaDevices.enumerateDevices();
        return kind ? deviceList.filter(device => device.kind === kind) : deviceList;
    }

    async updateDeviceList() {
        if (!this.#isPublish) {
            return [];
        }
        const deviceList = await this.getDeviceList();
        this.#fillDeviceSelect(this.#videoInputEl, deviceList, 'videoinput', this.#textMap.camera);
        this.#fillDeviceSelect(this.#audioInputEl, deviceList, 'audioinput', this.#textMap.microphone);
        return deviceList;
    }

    openSettings() {
        this.#rootEl.setAttribute('data-settings', true);
        this.updateDeviceList().catch(() => {});
    }

    closeSettings() {
        this.#rootEl.setAttribute('data-settings', false);
    }

    toggleSettings() {
        if (this.#rootEl.getAttribute('data-settings') === 'true') {
            this.closeSettings();
        } else {
            this.openSettings();
        }
    }

    async play() {
        if (!this.#hasSource()) {
            throw new xiombError('NO_STREAM', 'No stream');
        }
        try {
            await this.#videoEl.play();
        } catch (e) {
            if (e && e.name === 'AbortError') {
                return;
            }
            if (!e || e.name !== 'NotAllowedError' || this.#videoEl.muted) {
                throw new xiombError('PLAY_FAILED', e && e.message, e);
            }
            this.#muted = true;
            this.#videoEl.muted = true;
            this.#render();
            this.emit('mute', true);
            try {
                await this.#videoEl.play();
            } catch (retryError) {
                throw new xiombError('AUTOPLAY_BLOCKED', 'Autoplay blocked', retryError);
            }
        }
        this.emit('play');
    }

    pause() {
        this.#videoEl.pause();
        this.emit('pause');
    }

    stop() {
        this.#videoEl.pause();
        this.setMediaStream(null);
        this.setPlayURL(null);
        this.emit('stop');
    }

    mute() {
        this.#muted = true;
        this.#applyTrackState();
        if (!this.#isPublish) {
            this.#videoEl.muted = true;
        }
        this.#render();
        this.emit('mute', true);
    }

    unmute() {
        this.#muted = false;
        this.#applyTrackState();
        if (!this.#isPublish) {
            this.#videoEl.muted = !this.#isKindEnabled('audio');
        }
        this.#render();
        this.emit('mute', false);
    }

    isMuted() {
        return this.#muted;
    }

    muteVideo() {
        this.#videoMuted = true;
        this.#applyTrackState();
        this.#render();
        this.emit('videoMute', true);
    }

    unmuteVideo() {
        this.#videoMuted = false;
        this.#applyTrackState();
        this.#render();
        this.emit('videoMute', false);
    }

    isVideoMuted() {
        return this.#videoMuted;
    }

    setVolume(volume) {
        this.#volume = Math.min(1, Math.max(0, Number(volume) || 0));
        this.#videoEl.volume = this.#volume;
        this.emit('volume', this.#volume);
    }

    getVolume() {
        return this.#volume;
    }

    getVideoSize() {
        return {width: this.#videoEl.videoWidth, height: this.#videoEl.videoHeight};
    }

    destroy() {
        if (this.#destroyed) {
            return;
        }
        this.#destroyed = true;
        clearTimeout(this.#idleTimer);
        this.stop();
        if (this.#rootEl.parentNode) {
            this.#rootEl.parentNode.removeChild(this.#rootEl);
        }
        this.emit('destroy');
    }
}

// MEDIA_NOT_FOUND — сервер проекта после перезапуска не знает медиа (ответ media.resume)
const RESTART_REASON_LIST = ['SERVICE_UNAVAILABLE', 'MEDIA_TERMINATED', 'SESSION_RESET', 'MEDIA_NOT_FOUND'];
const PLAY_RESTART_REASON_LIST = ['STREAM_ENDED', 'STREAM_NOT_FOUND', 'STREAM_NOT_READY'];
const START_RETRY_REASON_LIST = ['NOT_CONNECTED', 'TIMEOUT'];
const RESTART_DELAY_MIN = 1000;
const RESTART_DELAY_MAX = 10000;

/**
 * Перезапуск сессии после закрытия по причине, которую стоит повторить: переезд проекта на другое ядро и т.п.
 */
class xiombRestart {
    #isPublish;
    #options;
    #startedAt = 0;
    #delay = RESTART_DELAY_MIN;
    #timer = null;
    #stopped = false;

    constructor(isPublish, options) {
        this.#isPublish = isPublish;
        this.#options = options;
    }

    #getTimeout() {
        return this.#options.restartTimeout || 60000;
    }

    canRestart(reason, isStartError) {
        if (this.#stopped || this.#options.autoRestart === false || !reason || !reason.name) {
            return false;
        }
        const reasonList = [
            ...RESTART_REASON_LIST,
            ...(this.#isPublish ? [] : PLAY_RESTART_REASON_LIST),
            ...(isStartError ? START_RETRY_REASON_LIST : []),
        ];
        if (reasonList.indexOf(reason.name) === -1) {
            return false;
        }
        return !this.#startedAt || Date.now() - this.#startedAt < this.#getTimeout();
    }

    schedule(callback) {
        if (!this.#startedAt) {
            this.#startedAt = Date.now();
        }
        clearTimeout(this.#timer);
        this.#timer = setTimeout(callback, this.#delay);
        this.#delay = Math.min(this.#delay * 2, RESTART_DELAY_MAX);
    }

    reset() {
        clearTimeout(this.#timer);
        this.#startedAt = 0;
        this.#delay = RESTART_DELAY_MIN;
    }

    stop() {
        this.#stopped = true;
        clearTimeout(this.#timer);
    }
}

const RENEGOTIATE_RETRY_MIN$1 = 1000;
const RENEGOTIATE_RETRY_MAX$1 = 5000;
const SERVICE_CODEC_LIST = ['RTX', 'RED', 'ULPFEC', 'FLEXFEC-03', 'CN', 'TELEPHONE-EVENT'];

class xiombSession extends xiombEmitter {
    #xiomb;
    #direction;
    #name;
    #options;
    #ID = null;
    #turn = '';
    #status = 'connect';
    #lastStat = null;
    #closed = false;
    #peerConnection = null;
    #peerConnectionAccepted = false;
    #previousPeerConnection = null;
    #pendingTrackList = [];
    #mediaStream;
    #localCandidateList = [];
    #remoteCandidateList = [];
    #renegotiating = false;
    #needRenegotiate = false;
    #renegotiateAgain = false;
    #retryDelay = RENEGOTIATE_RETRY_MIN$1;
    #retryTimer = null;
    #restart;

    constructor(xiomb, direction, name, options) {
        super();
        this.#xiomb = xiomb;
        this.#direction = direction;
        this.#name = name;
        this.#options = options || {};
        this.#restart = new xiombRestart(direction === 'publish', this.#options);
        this.#mediaStream = direction === 'publish' ? this.#options.mediaStream : new MediaStream();
    }

    #isKindEnabled(kind) {
        return this.#xiomb.getParams()[kind] !== false;
    }

    #addInactiveTransceiver(peerConnection) {
        const kindList = peerConnection.getTransceivers().map(transceiver => transceiver.receiver.track.kind);
        for (const kind of ['video', 'audio']) {
            if (kindList.indexOf(kind) === -1 && !this.#isKindEnabled(kind)) {
                peerConnection.addTransceiver(kind, {direction: 'inactive'});
            }
        }
    }

    #getCodecList() {
        return this.#options.codecList || [];
    }

    #sendCandidate(candidate) {
        this.#xiomb.notify('media.signal', {ID: this.#ID, candidate});
    }

    #acceptPeerConnection() {
        this.#peerConnectionAccepted = true;
        for (const candidate of this.#localCandidateList) {
            this.#sendCandidate(candidate);
        }
        this.#localCandidateList = [];
    }

    #closePreviousPeerConnection() {
        const trackList = this.#pendingTrackList;
        this.#pendingTrackList = [];
        for (const track of trackList) {
            this.#addTrack(track);
        }
        if (this.#previousPeerConnection) {
            this.#previousPeerConnection.close();
        }
        this.#previousPeerConnection = null;
    }

    #addTrack(track) {
        const trackList = this.#mediaStream.getTracks();
        if (trackList.indexOf(track) !== -1 || !this.#isKindEnabled(track.kind)) {
            return;
        }
        this.#mediaStream = new MediaStream([...trackList.filter(oldTrack => oldTrack.kind !== track.kind), track]);
        this.emit('stream', this.#mediaStream);
    }

    #cleanup() {
        if (this.#previousPeerConnection) {
            this.#previousPeerConnection.close();
        }
        this.#previousPeerConnection = null;
        this.#pendingTrackList = [];
        if (this.#peerConnection) {
            this.#peerConnection.close();
        }
        this.#peerConnection = null;
        this.#peerConnectionAccepted = false;
        if (!this.isPublish()) {
            for (const track of this.#mediaStream.getTracks()) {
                track.stop();
            }
        }
    }

    #preferCodecList(peerConnection) {
        const wantedCodecList = this.#getCodecList().map(codec => String(codec).toUpperCase());
        const capabilitySource = this.isPublish() ? window.RTCRtpSender : window.RTCRtpReceiver;
        if (!wantedCodecList.length || !capabilitySource || typeof capabilitySource.getCapabilities !== 'function') {
            return;
        }
        const capabilities = capabilitySource.getCapabilities('video');
        const codecList = capabilities && capabilities.codecs ? capabilities.codecs : [];
        const getName = codec => codec.mimeType.split('/')[1].toUpperCase();
        const preferredCodecList = wantedCodecList.flatMap(name => codecList.filter(codec => getName(codec) === name));
        if (!preferredCodecList.length) {
            return;
        }
        const orderedCodecList = [...preferredCodecList, ...codecList.filter(codec => SERVICE_CODEC_LIST.indexOf(getName(codec)) !== -1)];
        for (const transceiver of peerConnection.getTransceivers()) {
            const track = transceiver.sender.track || transceiver.receiver.track;
            if (track && track.kind === 'video' && typeof transceiver.setCodecPreferences === 'function') {
                transceiver.setCodecPreferences(orderedCodecList);
            }
        }
    }

    async #createOffer() {
        // старая нода показывает, пока новая не подключится
        if (this.#peerConnection && !this.#previousPeerConnection && this.#peerConnectionAccepted
            && this.#peerConnection.connectionState === 'connected') {
            this.#previousPeerConnection = this.#peerConnection;
        } else if (this.#peerConnection) {
            this.#peerConnection.close();
        }
        this.#peerConnection = null;
        this.#pendingTrackList = [];
        this.#remoteCandidateList = [];
        this.#localCandidateList = [];
        this.#peerConnectionAccepted = false;
        const {iceServerList, turn} = await this.#xiomb.getIceServers();
        this.#turn = turn;
        const peerConnection = new RTCPeerConnection({iceServers: iceServerList});
        this.#peerConnection = peerConnection;
        peerConnection.onicecandidate = event => {
            if (!event.candidate || peerConnection !== this.#peerConnection) {
                return;
            }
            const candidate = {candidate: event.candidate.candidate, sdpMLineIndex: event.candidate.sdpMLineIndex};
            if (this.#peerConnectionAccepted) {
                this.#sendCandidate(candidate);
            } else {
                this.#localCandidateList.push(candidate);
            }
        };
        peerConnection.onconnectionstatechange = () => {
            if (peerConnection !== this.#peerConnection) {
                return;
            }
            if (peerConnection.connectionState === 'connected' || peerConnection.connectionState === 'failed') {
                this.#closePreviousPeerConnection();
            }
            this.emit('state', peerConnection.connectionState);
        };
        if (this.isPublish()) {
            for (const track of this.#mediaStream.getTracks()) {
                if (this.#isKindEnabled(track.kind)) {
                    peerConnection.addTrack(track, this.#mediaStream);
                }
            }
            this.#addInactiveTransceiver(peerConnection);
        } else {
            peerConnection.addTransceiver('video', {direction: this.#isKindEnabled('video') ? 'recvonly' : 'inactive'});
            peerConnection.addTransceiver('audio', {direction: this.#isKindEnabled('audio') ? 'recvonly' : 'inactive'});
            peerConnection.ontrack = event => {
                if (peerConnection !== this.#peerConnection) {
                    return;
                }
                if (this.#previousPeerConnection) {
                    this.#pendingTrackList.push(event.track);
                } else {
                    this.#addTrack(event.track);
                }
            };
        }
        this.#preferCodecList(peerConnection);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        return {type: offer.type, sdp: offer.sdp};
    }

    #restorePreviousPeerConnection() {
        if (!this.#previousPeerConnection) {
            return;
        }
        if (this.#peerConnection) {
            this.#peerConnection.close();
        }
        this.#peerConnection = this.#previousPeerConnection;
        this.#previousPeerConnection = null;
        this.#pendingTrackList = [];
        this.#peerConnectionAccepted = true;
    }

    async #renegotiate() {
        if (this.#closed || !this.#needRenegotiate) {
            return;
        }
        if (this.#renegotiating) {
            this.#renegotiateAgain = true;
            return;
        }
        clearTimeout(this.#retryTimer);
        this.#renegotiating = true;
        this.#renegotiateAgain = false;
        let done = false;
        try {
            const offer = await this.#createOffer();
            await this.#xiomb.request('media.renegotiate', {ID: this.#ID, offer, codecs: this.#getCodecList(), turn: this.#turn});
            done = true;
        } catch (e) {
            console.warn('[xiomb] renegotiate failed:', e && e.name);
            this.#restorePreviousPeerConnection();
        }
        this.#renegotiating = false;
        if (done) {
            this.#retryDelay = RENEGOTIATE_RETRY_MIN$1;
            this.#acceptPeerConnection();
        }
        this.#localCandidateList = [];
        if (this.#closed || !this.#needRenegotiate) {
            return;
        }
        if (done && this.#renegotiateAgain) {
            return this.#renegotiate();
        }
        if (!done) {
            this.#retryTimer = setTimeout(() => this.#renegotiate(), this.#retryDelay);
            this.#retryDelay = Math.min(this.#retryDelay * 2, RENEGOTIATE_RETRY_MAX$1);
        }
    }

    async #start() {
        let mediaSessionInfo;
        try {
            const offer = await this.#createOffer();
            mediaSessionInfo = await this.#xiomb.request(`media.${this.#direction}`, {
                name: this.#name,
                offer,
                codecs: this.#getCodecList(),
                projectID: this.#options.projectID || '',
                custom: this.#options.custom || {},
                turn: this.#turn,
            });
        } catch (e) {
            this.#cleanup();
            throw e;
        }
        if (this.#closed) {
            await this.#xiomb.request('media.close', {ID: mediaSessionInfo.ID}).catch(() => {});
            throw new xiombError('STOPPED', 'Stopped');
        }
        this.#ID = mediaSessionInfo.ID;
        this.#name = mediaSessionInfo.name;
        this.#status = mediaSessionInfo.status;
        this.#acceptPeerConnection();
        this.#xiomb.addMediaSession(this);
        return this;
    }

    #restartLater(reason) {
        this.#xiomb.deleteMediaSession(this);
        this.#ID = null;
        clearTimeout(this.#retryTimer);
        this.#needRenegotiate = false;
        this.#cleanup();
        if (!this.isPublish()) {
            this.#mediaStream = new MediaStream();
        }
        this.#status = 'reconnect';
        this.emit('status', {status: 'reconnect', renegotiate: false, reason});
        this.#restart.schedule(() => this.#attemptRestart());
    }

    async #attemptRestart() {
        if (this.#closed) {
            return;
        }
        try {
            await this.#start();
        } catch (e) {
            if (this.#closed) {
                return;
            }
            const reason = {name: e && e.name, message: e && e.message};
            if (this.#restart.canRestart(reason, true)) {
                this.#restart.schedule(() => this.#attemptRestart());
            } else {
                this.#close(reason);
            }
            return;
        }
        this.#restart.reset();
        this.emit('restarted', {ID: this.#ID});
        this.emit('status', {status: this.#status, renegotiate: false, reason: null});
    }

    #close(reason) {
        this.#closed = true;
        this.#status = 'stop';
        clearTimeout(this.#retryTimer);
        this.#cleanup();
        if (this.#ID) {
            this.#xiomb.deleteMediaSession(this);
        }
        this.emit('closed', reason);
    }

    async #applySignal(peerConnection, data) {
        if (data.description) {
            await peerConnection.setRemoteDescription(data.description);
            const candidateList = this.#remoteCandidateList;
            this.#remoteCandidateList = [];
            await Promise.all(candidateList.map(candidate => peerConnection.addIceCandidate(candidate)));
        } else if (data.candidate && data.candidate.candidate) {
            if (peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(data.candidate);
            } else {
                this.#remoteCandidateList.push(data.candidate);
            }
        }
    }

    getID() {
        return this.#ID;
    }

    getName() {
        return this.#name;
    }

    getDirection() {
        return this.#direction;
    }

    isPublish() {
        return this.#direction === 'publish';
    }

    getTransport() {
        return 'webrtc';
    }

    getPlayURL() {
        return null;
    }

    getStatus() {
        return this.#status;
    }

    isClosed() {
        return this.#closed;
    }

    getMediaStream() {
        return this.#mediaStream;
    }

    getPeerConnection() {
        return this.#peerConnection;
    }

    getLastStat() {
        return this.#lastStat;
    }

    async replaceMediaStream(mediaStream) {
        if (!this.isPublish()) {
            return;
        }
        this.#mediaStream = mediaStream;
        const transceiverList = this.#peerConnection ? this.#peerConnection.getTransceivers() : [];
        const promiseList = [];
        for (const transceiver of transceiverList) {
            const kind = transceiver.receiver.track ? transceiver.receiver.track.kind : null;
            if (!this.#isKindEnabled(kind)) {
                continue;
            }
            const track = mediaStream.getTracks().filter(mediaTrack => mediaTrack.kind === kind)[0] || null;
            if (transceiver.sender.track !== track) {
                promiseList.push(transceiver.sender.replaceTrack(track));
            }
        }
        return Promise.all(promiseList);
    }

    start() {
        return this.#start();
    }

    async close() {
        if (this.#closed) {
            return;
        }
        this.#restart.stop();
        const ID = this.#ID;
        this.onClosed({reason: null});
        if (ID) {
            return this.#xiomb.request('media.close', {ID}).catch(() => {});
        }
    }

    onSignal(data) {
        if (this.#peerConnection) {
            this.#applySignal(this.#peerConnection, data).catch(e => console.error('[xiomb] signal', e));
        }
    }

    onStat(data) {
        this.#lastStat = data;
        this.emit('stat', data);
    }

    onStatus(data) {
        this.#status = data.status;
        this.#needRenegotiate = data.status === 'reconnect' && !!data.renegotiate;
        this.emit('status', {status: data.status, renegotiate: data.renegotiate, reason: data.reason});
        if (this.#needRenegotiate) {
            this.#renegotiate();
        } else {
            clearTimeout(this.#retryTimer);
        }
    }

    onClosed(data) {
        if (this.#closed) {
            return;
        }
        const reason = data && data.reason ? data.reason : null;
        if (this.#ID && this.#restart.canRestart(reason, false)) {
            return this.#restartLater(reason);
        }
        this.#close(reason);
    }
}

const RENEGOTIATE_RETRY_MIN = 1000;
const RENEGOTIATE_RETRY_MAX = 5000;

class xiombHlsSession extends xiombEmitter {
    #xiomb;
    #name;
    #options;
    #ID = null;
    #status = 'connect';
    #lastStat = null;
    #closed = false;
    #playURL = null;
    #byLink = false;
    #renegotiating = false;
    #needRenegotiate = false;
    #retryDelay = RENEGOTIATE_RETRY_MIN;
    #retryTimer = null;
    #restart;

    constructor(xiomb, name, options) {
        super();
        this.#xiomb = xiomb;
        this.#name = name;
        this.#options = options || {};
        this.#restart = new xiombRestart(false, this.#options);
    }

    #setPlayURL(playURL) {
        if (!playURL) {
            throw new xiombError('NOT_SUPPORTED', 'HLS not supported');
        }
        this.#playURL = playURL;
        this.emit('stream', this.#playURL);
    }

    async #renegotiate() {
        if (this.#closed || !this.#needRenegotiate || this.#renegotiating) {
            return;
        }
        clearTimeout(this.#retryTimer);
        this.#renegotiating = true;
        try {
            const mediaSessionInfo = await this.#xiomb.request('media.renegotiate', {ID: this.#ID});
            this.#renegotiating = false;
            this.#retryDelay = RENEGOTIATE_RETRY_MIN;
            if (!this.#closed) {
                this.#setPlayURL(mediaSessionInfo.playURL);
            }
        } catch (e) {
            this.#renegotiating = false;
            console.warn('[xiomb] renegotiate failed:', e && e.name);
            if (this.#closed || !this.#needRenegotiate) {
                return;
            }
            this.#retryTimer = setTimeout(() => this.#renegotiate(), this.#retryDelay);
            this.#retryDelay = Math.min(this.#retryDelay * 2, RENEGOTIATE_RETRY_MAX);
        }
    }

    // по ссылке: <вход ядра>/<проект>/<поток>/index.m3u8?<параметры сокета>; решают auth и play проекта
    #startByLink(hlsEntry) {
        const projectID = this.#options.projectID || hlsEntry.projectID;
        const queryMap = this.#xiomb.getQuery();
        const query = Object.keys(queryMap)
            .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(queryMap[key] == null ? '' : queryMap[key])}`)
            .join('&');
        this.#byLink = true;
        this.#ID = null;
        this.#setPlayURL(`${hlsEntry.url}/${encodeURIComponent(projectID)}/${encodeURIComponent(this.#name)}/index.m3u8${query ? `?${query}` : ''}`);
        this.#status = 'play';
        this.emit('status', {status: 'play', renegotiate: false, reason: null});
        return this;
    }

    async #start() {
        const hlsEntry = this.#xiomb.getHlsEntry();
        if (hlsEntry) {
            return this.#startByLink(hlsEntry);
        }
        const mediaSessionInfo = await this.#xiomb.request('media.play', {
            name: this.#name,
            transport: 'hls',
            projectID: this.#options.projectID || '',
            custom: this.#options.custom || {},
        });
        if (this.#closed) {
            await this.#xiomb.request('media.close', {ID: mediaSessionInfo.ID}).catch(() => {});
            throw new xiombError('STOPPED', 'Stopped');
        }
        this.#ID = mediaSessionInfo.ID;
        this.#name = mediaSessionInfo.name;
        this.#status = mediaSessionInfo.status;
        this.#xiomb.addMediaSession(this);
        this.#setPlayURL(mediaSessionInfo.playURL);
        return this;
    }

    #restartLater(reason) {
        this.#xiomb.deleteMediaSession(this);
        this.#ID = null;
        clearTimeout(this.#retryTimer);
        this.#needRenegotiate = false;
        this.#status = 'reconnect';
        this.emit('status', {status: 'reconnect', renegotiate: false, reason});
        this.#restart.schedule(() => this.#attemptRestart());
    }

    async #attemptRestart() {
        if (this.#closed) {
            return;
        }
        try {
            await this.#start();
        } catch (e) {
            if (this.#closed) {
                return;
            }
            const reason = {name: e && e.name, message: e && e.message};
            if (this.#restart.canRestart(reason, true)) {
                this.#restart.schedule(() => this.#attemptRestart());
            } else {
                this.#close(reason);
            }
            return;
        }
        this.#restart.reset();
        this.emit('restarted', {ID: this.#ID});
        this.emit('status', {status: this.#status, renegotiate: false, reason: null});
    }

    #close(reason) {
        this.#closed = true;
        this.#status = 'stop';
        clearTimeout(this.#retryTimer);
        if (this.#ID) {
            this.#xiomb.deleteMediaSession(this);
        }
        this.emit('closed', reason);
    }

    getID() {
        return this.#ID;
    }

    getName() {
        return this.#name;
    }

    getDirection() {
        return 'play';
    }

    getTransport() {
        return 'hls';
    }

    isPublish() {
        return false;
    }

    getStatus() {
        return this.#status;
    }

    isClosed() {
        return this.#closed;
    }

    getPlayURL() {
        return this.#playURL;
    }

    getMediaStream() {
        return null;
    }

    getPeerConnection() {
        return null;
    }

    getLastStat() {
        return this.#lastStat;
    }

    async replaceMediaStream() {}

    start() {
        return this.#start();
    }

    async close() {
        if (this.#closed) {
            return;
        }
        this.#restart.stop();
        if (this.#byLink) {
            // по ссылке: нода закроет зрителя сама, когда плеер перестанет спрашивать плейлист
            this.#close(null);
            return;
        }
        const ID = this.#ID;
        this.onClosed({reason: null});
        if (ID) {
            return this.#xiomb.request('media.close', {ID}).catch(() => {});
        }
    }

    onSignal() {}

    onStat(data) {
        this.#lastStat = data;
        this.emit('stat', data);
    }

    onStatus(data) {
        this.#status = data.status;
        this.#needRenegotiate = data.status === 'reconnect' && !!data.renegotiate;
        this.emit('status', {status: data.status, renegotiate: data.renegotiate, reason: data.reason});
        if (this.#needRenegotiate) {
            this.#renegotiate();
        } else {
            clearTimeout(this.#retryTimer);
        }
    }

    onClosed(data) {
        if (this.#closed) {
            return;
        }
        const reason = data && data.reason ? data.reason : null;
        if (this.#ID && this.#restart.canRestart(reason, false)) {
            return this.#restartLater(reason);
        }
        this.#close(reason);
    }
}

const STAT_INTERVAL = 1000;

const createError = e => {
    if (e instanceof xiombError) {
        return e;
    }
    if (e && typeof e.name === 'string' && e.name && !(e instanceof Error)) {
        return new xiombError(e.name, e.message, e);
    }
    return new xiombError('MEDIA_ERROR', e && e.message, e);
};

class xiombObject extends xiombEmitter {
    #xiomb;
    #isPublish;
    #streamName;
    #options;
    #player;
    #ownPlayer;
    #mediaSession = null;
    #transport = null;
    #mediaStat;
    #status = 'new';
    #startID = 0;
    #startPromise = null;
    #capturePromise = null;
    #destroyed = false;
    #statTimer = null;

    constructor(xiomb, isPublish, streamName, options) {
        super();
        this.#xiomb = xiomb;
        this.#isPublish = !!isPublish;
        this.#streamName = streamName;
        this.#options = options || {};
        this.#ownPlayer = !this.#options.player;
        this.#player = this.#options.player || xiomb.createPlayer(this.#isPublish, this.#options.targetEl || null, {
            constraints: this.#options.constraints,
            title: this.#options.title,
            textList: this.#options.textList,
        });
        if (this.#player.isPublish() !== this.#isPublish) {
            throw new xiombError('INVALID_PLAYER', 'Invalid player');
        }
        this.#mediaStat = new xiombStat(this.#isPublish);
        this.#player.on('request', this.#onPlayerRequest);
        this.#player.on('stream', this.#onPlayerStream);
        this.#player.on('deviceError', this.#onPlayerDeviceError);
        this.#player.on('playError', this.#onPlayerPlayError);
        this.#player.on('destroy', this.#onPlayerDestroy);
        this.#setStatus(this.#getIdleStatus());
        setTimeout(() => {
            if (this.#destroyed) {
                return;
            }
            const autoStart = this.#options.autoStart === undefined ? !this.#isPublish : this.#options.autoStart;
            if (autoStart) {
                this.start().catch(() => {});
            } else if (this.#isPublish) {
                this.capture().catch(() => {});
            }
        }, 0);
    }

    #getIdleStatus() {
        return this.#isPublish ? (this.#player.getMediaStream() ? 'preview' : 'new') : 'stop';
    }

    #setStatus(status, message) {
        this.#status = status;
        this.#player.setStatus(status, message);
        this.emit('status', status, message || '');
    }

    #showError(error) {
        this.#player.setMessage(this.#xiomb.getMessage(error));
        this.emit('error', error);
    }

    #checkStart(startID) {
        if (this.#destroyed || startID !== this.#startID) {
            throw new xiombError('STOPPED', 'Stopped');
        }
    }

    #finishSession(reason) {
        const mediaSession = this.#mediaSession;
        this.stopStat();
        this.#mediaStat.reset();
        this.#mediaSession = null;
        this.#startPromise = null;
        if (!this.#isPublish && !this.#destroyed) {
            this.#player.setMediaStream(null);
            this.#player.setPlayURL(null);
        }
        if (this.#destroyed) {
            return mediaSession;
        }
        if (!this.#isPublish && reason && reason.name === 'STREAM_ENDED') {
            this.#setStatus('stop');
            this.emit('stop', reason);
            return mediaSession;
        }
        if (reason) {
            this.#setStatus('failed', this.#xiomb.getMessage(reason));
            this.emit('error', reason);
        } else {
            this.#setStatus(this.#getIdleStatus());
        }
        this.emit('stop', reason || null);
        return mediaSession;
    }

    #attachMedia(mediaSession) {
        if (mediaSession.getTransport() === 'hls') {
            this.#player.setPlayURL(mediaSession.getPlayURL(), this.#xiomb.getHls(), this.#xiomb.getHlsConfig());
        } else {
            this.#player.setMediaStream(mediaSession.getMediaStream());
        }
    }

    #bindMediaSession(mediaSession) {
        const isCurrent = () => mediaSession === this.#mediaSession;
        mediaSession.on('status', data => {
            if (isCurrent()) {
                this.#setStatus(data.status);
            }
        });
        mediaSession.on('state', connectionState => {
            if (isCurrent()) {
                this.emit('state', connectionState);
            }
        });
        mediaSession.on('stat', data => {
            if (isCurrent()) {
                this.emit('serverStat', data);
            }
        });
        mediaSession.on('stream', () => {
            if (!isCurrent()) {
                return;
            }
            if (!this.#isPublish) {
                this.#attachMedia(mediaSession);
            }
            this.#player.play().catch(error => this.#showError(error));
        });
        mediaSession.on('closed', reason => {
            if (isCurrent()) {
                ++this.#startID;
                this.#finishSession(reason ? createError(typeof reason === 'object' ? reason : {name: String(reason)}) : null);
            }
        });
    }

    #getCustom() {
        const custom = typeof this.#options.custom === 'function' ? this.#options.custom(this) : this.#options.custom;
        return {...custom};
    }

    #onPlayerRequest = action => {
        switch (action) {
            case 'start':
                return this.start().catch(() => {});
            case 'stop':
                return this.stop();
        }
    };

    #onPlayerDestroy = () => {
        this.destroy();
    };

    #onPlayerDeviceError = error => {
        if (!this.#startPromise && !this.#capturePromise && !this.#player.getMediaStream()) {
            this.#setStatus('failed', this.#xiomb.getMessage(error));
            this.emit('error', error);
        } else {
            this.#showError(error);
        }
    };

    #onPlayerPlayError = error => {
        this.#showError(error);
    };

    #onPlayerStream = mediaStream => {
        if (!this.#isPublish || !mediaStream) {
            return;
        }
        if (!this.#startPromise && !this.#capturePromise && (this.#status === 'failed' || this.#status === 'new')) {
            this.#setStatus('preview');
        }
        if (this.#mediaSession) {
            this.#mediaSession.replaceMediaStream(mediaStream).catch(e => this.#showError(createError(e)));
        }
    };

    async #capture() {
        let mediaStream;
        try {
            mediaStream = await this.#player.getUserMedia(this.#options.constraints);
        } catch (e) {
            const error = createError(e);
            this.#capturePromise = null;
            if (!this.#startPromise && !this.#destroyed) {
                this.#setStatus('failed', this.#xiomb.getMessage(error));
                this.emit('error', error);
            }
            throw error;
        }
        this.#capturePromise = null;
        if (!this.#startPromise && !this.#destroyed) {
            this.#setStatus('preview');
        }
        return mediaStream;
    }

    async #start(startID) {
        let mediaSession = null;
        this.#setStatus('connect');
        try {
            await this.#xiomb.connect();
            this.#checkStart(startID);
            this.#transport = this.#isPublish ? 'webrtc' : this.#xiomb.selectTransport(this.#options.transport);
            if (this.#isPublish) {
                await this.capture();
            }
            this.#checkStart(startID);
            mediaSession = this.#xiomb.createMediaSession(this.#isPublish ? 'publish' : 'play', this.#streamName, {
                transport: this.#transport,
                codecList: this.#options.codecList || [],
                projectID: this.#options.projectID || '',
                custom: this.#getCustom(),
                mediaStream: this.#isPublish ? this.#player.getMediaStream() : null,
            });
            this.#mediaSession = mediaSession;
            this.#bindMediaSession(mediaSession);
            if (!this.#isPublish) {
                this.#attachMedia(mediaSession);
            }
            await mediaSession.start();
            this.#checkStart(startID);
            this.#setStatus(mediaSession.getStatus());
            this.emit('start', this);
            return this;
        } catch (e) {
            const error = createError(e);
            if (startID === this.#startID) {
                ++this.#startID;
                this.#finishSession(error);
                if (mediaSession) {
                    mediaSession.close();
                }
            }
            throw error;
        }
    }

    getID() {
        return this.#mediaSession ? this.#mediaSession.getID() : null;
    }

    getStreamName() {
        return this.#streamName;
    }

    isPublish() {
        return this.#isPublish;
    }

    getStatus() {
        return this.#status;
    }

    isActive() {
        return !!this.#startPromise;
    }

    isDestroyed() {
        return this.#destroyed;
    }

    getOptions() {
        return this.#options;
    }

    getPlayer() {
        return this.#player;
    }

    getMediaSession() {
        return this.#mediaSession;
    }

    getTransport() {
        return this.#transport;
    }

    getMediaStream() {
        return this.#player.getMediaStream();
    }

    getServerStat() {
        return this.#mediaSession ? this.#mediaSession.getLastStat() : null;
    }

    capture() {
        if (!this.#isPublish) {
            return Promise.reject(new xiombError('NOT_PUBLISH', 'Not publish'));
        }
        if (this.#player.getMediaStream()) {
            return Promise.resolve(this.#player.getMediaStream());
        }
        if (!this.#capturePromise) {
            if (!this.#startPromise) {
                this.#setStatus('capture');
            }
            this.#capturePromise = this.#capture();
        }
        return this.#capturePromise;
    }

    start() {
        if (this.#destroyed) {
            return Promise.reject(new xiombError('DESTROYED', 'Destroyed'));
        }
        if (!this.#startPromise) {
            this.#startPromise = this.#start(++this.#startID);
        }
        return this.#startPromise;
    }

    async stop() {
        if (!this.#startPromise) {
            return;
        }
        ++this.#startID;
        const mediaSession = this.#finishSession(null);
        if (mediaSession) {
            return mediaSession.close();
        }
    }

    async getStat() {
        const peerConnection = this.#mediaSession ? this.#mediaSession.getPeerConnection() : null;
        const stat = await this.#mediaStat.collect(peerConnection);
        stat.status = this.#status;
        stat.transport = this.#transport;
        stat.connectionState = peerConnection ? peerConnection.connectionState : null;
        stat.server = this.getServerStat();
        return stat;
    }

    startStat(interval) {
        this.stopStat();
        const tickInterval = interval || STAT_INTERVAL;
        const tick = async () => {
            try {
                this.emit('stat', await this.getStat());
            } catch (e) {
                console.warn('[xiomb] stat', e);
            }
            if (this.#statTimer !== null) {
                this.#statTimer = setTimeout(tick, tickInterval);
            }
        };
        this.#statTimer = setTimeout(tick, 0);
    }

    stopStat() {
        clearTimeout(this.#statTimer);
        this.#statTimer = null;
    }

    destroy() {
        if (this.#destroyed) {
            return;
        }
        this.#destroyed = true;
        this.stop().catch(() => {});
        this.#player.off('request', this.#onPlayerRequest);
        this.#player.off('stream', this.#onPlayerStream);
        this.#player.off('deviceError', this.#onPlayerDeviceError);
        this.#player.off('playError', this.#onPlayerPlayError);
        if (this.#ownPlayer) {
            this.#player.destroy();
        } else if (this.#isPublish && this.#player.isCaptured()) {
            this.#player.stop();
        }
        this.#status = 'destroy';
        this.emit('destroy');
    }
}

/**
 * xSocket v2.3.0
 * @licence MIT
 * @author Vadim Pride (pride.mk.ua@gmail.com)
 * @link https://github.com/pride-oO/xsocket
 */
const xSocket = function xSocket(serverUrl, query, settings){
    return new xSocket.Client(serverUrl, query, settings);
};
xSocket.VERSION   = '2.3.0';
xSocket.window    = typeof window === 'object' ? window : false;
xSocket.WebSocket = typeof WebSocket !== 'undefined' ? WebSocket : false;
xSocket.process   = false;

class EventEmitter {

    constructor(){
        this.__listenerMap = Object.create(null);
        this.__maxListeners = 10;
    }

    /**
     * Append EE listener
     * @param name
     * @param callback
     * @param once
     * @return {EventEmitter}
     */
    on(name, callback, once){
        if(typeof name !== 'string' || typeof callback !== 'function'){
            return this;
        }
        const listenerList = this.__listenerMap[name] || (this.__listenerMap[name] = []);
        listenerList.push({'callback' : callback, 'once' : once === true});
        if(this.__maxListeners > 0 && listenerList.length > this.__maxListeners){
            console.warn('EventEmitter ', name, ', exceeded maxListeners : ', this.__maxListeners + '/' + listenerList.length, '. Use EE.setMaxListeners(n)!');
        }
        return this;
    }

    /**
     * Append once EE listener
     * @param name
     * @param callback
     * @return {EventEmitter}
     */
    once(name, callback){
        return this.on(name, callback, true);
    }

    /**
     * Getter all listener name
     * @returns {string[]}
     */
    getListerensName(){
        return Object.keys(this.__listenerMap);
    }

    /**
     * Clear all listener
     * @returns {{}}
     */
    clearAllListerens(){
        this.__listenerMap = Object.create(null);
        return this.__listenerMap;
    }

    /**
     * Getter count EE listener
     * @param name
     * @returns {number}
     */
    listenerCount(name){
        const listenerList = this.__listenerMap[name];
        return listenerList ? listenerList.length : 0;
    }

    /**
     * Set max listeners
     * @param count
     * @returns {boolean}
     */
    setMaxListeners(count){
        if(typeof count !== 'number'){
            return false;
        }
        this.__maxListeners = parseInt(count);
        return true;
    }

    /**
     * Delete EE listener
     * @param name
     * @param callback
     * @return {EventEmitter}
     */
    off(name, callback){
        const listenerList = this.__listenerMap[name];
        if(!listenerList || typeof callback !== 'function'){
            return this;
        }
        for(let i = listenerList.length - 1; i >= 0; i--){
            if(listenerList[i].callback === callback){
                listenerList.splice(i, 1);
            }
        }
        if(!listenerList.length){
            delete this.__listenerMap[name];
        }
        return this;
    }

    /**
     * Delete all EE listener
     * @param name
     * @return {EventEmitter}
     */
    offAll(name){
        delete this.__listenerMap[name];
        return this;
    }

    /**
     * Emit EE listener
     * @param name
     * @param argList
     * @return {EventEmitter}
     */
    emit(name, ...argList){
        let listenerList = this.__listenerMap[name];
        if(!listenerList){
            return this;
        }
        listenerList = listenerList.slice();
        for(let i = 0; i < listenerList.length; i++){
            const currentList = this.__listenerMap[name];
            const index = currentList ? currentList.indexOf(listenerList[i]) : -1;
            if(index === -1){
                continue;
            }
            if(listenerList[i].once){
                currentList.splice(index, 1);
                if(!currentList.length){
                    delete this.__listenerMap[name];
                }
            }
            listenerList[i].callback.apply(this, argList);
        }
        return this;
    }
}

const MSG_SO_UPDATE = 0;
const MSG_SD_CREATE = 1;
const MSG_SD_UPDATE = 2;
const MSG_SO_TIME   = 3;

/**
 *
 * @returns {Window|*}
 */
const getWindow = () => xSocket.window;

/**
 *
 * @returns {any}
 */
const getProcess = () => xSocket.process;

/**
 *
 * @param min
 * @param max
 * @returns {number}
 */
const getRandInt = (min, max) => Math.floor(min + Math.random() * (max + 1 - min));

/**
 *
 * @param data
 * @returns {boolean}
 */
const isBinary = (data) => typeof ArrayBuffer === 'function' && (data instanceof ArrayBuffer || ArrayBuffer.isView(data));

/**
 *
 * @param type
 * @returns {number}
 */
const getMessageDataIndex = (type) => type === MSG_SD_CREATE ? 4 : 2;

/**
 *
 * @param text
 * @returns {Uint8Array}
 */
const encodeText = (text) => {
    if(typeof TextEncoder === 'function'){
        return new TextEncoder().encode(text);
    }
    const binary = unescape(encodeURIComponent(text));
    const byteList = new Uint8Array(binary.length);
    for(let i = 0; i < binary.length; i++){
        byteList[i] = binary.charCodeAt(i);
    }
    return byteList;
};

/**
 *
 * @param byteList
 * @returns {string}
 */
const decodeText = (byteList) => {
    if(typeof TextDecoder === 'function'){
        return new TextDecoder().decode(byteList);
    }
    let binary = '';
    for(let i = 0; i < byteList.length; i++){
        binary += String.fromCharCode(byteList[i]);
    }
    return decodeURIComponent(escape(binary));
};

/**
 *
 * @param body
 * @returns {string|Uint8Array}
 */
const encodeMessage = (body) => {
    const dataIndex = getMessageDataIndex(body[0]);
    const data = body[dataIndex];
    if(!isBinary(data)){
        return JSON.stringify(body);
    }
    body = body.slice();
    body[dataIndex] = null;
    const headerBytes = encodeText(JSON.stringify(body));
    const dataBytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const frame = new Uint8Array(4 + headerBytes.length + dataBytes.length);
    new DataView(frame.buffer).setUint32(0, headerBytes.length);
    frame.set(headerBytes, 4);
    frame.set(dataBytes, 4 + headerBytes.length);
    return frame;
};

/**
 *
 * @param raw
 * @returns {Array|boolean}
 */
const decodeMessage = (raw) => {
    let body;
    try{
        if(typeof raw === 'string'){
            body = JSON.parse(raw);
        }else {
            const frame = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
            const headerLength = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0);
            body = JSON.parse(decodeText(frame.subarray(4, 4 + headerLength)));
            if(Array.isArray(body)){
                body[getMessageDataIndex(body[0])] = frame.subarray(4 + headerLength);
            }
        }
    }catch (e){
        return false;
    }
    return Array.isArray(body) && typeof body[0] === 'number' ? body : false;
};

var helpers = {
    getWindow,
    getProcess,
    getRandInt,
    isBinary,
    getMessageDataIndex,
    encodeText,
    decodeText,
    encodeMessage,
    decodeMessage,
    EventEmitter
};

class Data extends EventEmitter {

    /**
     *
     * @param __isOutput
     * @param __object
     * @param __socketObject
     */
    constructor(__isOutput, __object, __socketObject){
        super();
        this.setMaxListeners(0);
        __object = typeof __object === 'object' && __object ? __object : {};

        this.__isOutput     = !!__isOutput;
        this.__socketObject = __socketObject || false;
        this.__ID           = typeof __object.ID === 'string' ? __object.ID : '';
        this.__type         = typeof __object.type === 'string' ? __object.type : '';
        this.__data         = typeof __object.data === 'object' ? __object.data : {};
        this.__ttl          = typeof __object.ttl === 'number' && __object.ttl % 1 === 0 && __object.ttl >= 0 ? __object.ttl : Data.DEFAULT_TTL;
        const now           = this.__socketObject ? this.__socketObject.getTime() : Date.now();
        this.__time         = typeof __object.time === 'number' && __object.time > 0 ? __object.time : now;
        this.__resData      = {};
        this.__error        = false;
        this.__status       = Data.STATUS_NEW;
        this.__destroy      = false;
        this.__ttlTimeout   = setTimeout(() => {
            this.destroy('ttl', true);
        }, Math.max(0, Math.min(this.__ttl, this.__ttl - (now - this.__time))));
    }

    /**
     *
     * @returns {string}
     */
    getID(){
        return String(this.__ID);
    }

    /**
     *
     * @returns {string}
     */
    getType(){
        return String(this.__type);
    }

    /**
     *
     * @returns {number}
     */
    getTTL(){
        return this.__ttl;
    }

    /**
     *
     * @returns {number}
     */
    getTime(){
        return this.__time;
    }

    /**
     *
     * @returns {{}}
     */
    getData(){
        return this.__data || {};
    }

    /**
     *
     * @param key
     * @param def
     * @returns {*}
     */
    getDataVal(key, def){
        return this.getData()[key] || def;
    }

    /**
     *
     * @returns {{}}
     */
    getResData(){
        return this.__resData || {};
    }

    /**
     *
     * @param key
     * @param def
     * @returns {*}
     */
    getResDataVal(key, def){
        return this.getResData()[key] || def;
    }

    /**
     *
     * @returns {number}
     */
    getStatus(){
        return this.__status;
    }

    /**
     *
     * @returns {boolean|string}
     */
    getDestroy(){
        return this.__destroy || false;
    }

    /**
     *
     * @returns {SocketObject|boolean}
     */
    getSocketObject(){
        return this.__socketObject;
    }

    /**
     *
     * @returns {string|boolean}
     */
    getError(){
        return this.__error || false;
    }

    /**
     *
     * @returns {boolean}
     */
    isNew(){
        return this.__status === Data.STATUS_NEW;
    }

    /**
     *
     * @returns {boolean}
     */
    isSend(){
        return this.__status === Data.STATUS_SEND;
    }

    /**
     *
     * @returns {boolean}
     */
    isResponse(){
        return this.__status === Data.STATUS_RESPONSE;
    }

    /**
     *
     * @param data
     * @param error
     * @returns {Promise<Data>}
     */
    response(data, error){
        const promise = new Promise((resolve, reject) => {
            if(this.__isOutput){
                return reject(new Error('Output data'));
            }
            if(this.__destroy || this.isResponse() || !this.__ttl){
                return reject(new Error('destroy'));
            }
            this.setResData(data);
            this.setError(error);
            this.once('response', () => {
                resolve(this);
            });
            this.once('destroy', (msg) => {
                reject(new Error(msg));
            });
            this.__socketObject.getWsReady().then((ws) => {
                if(ws.sendObject([
                    MSG_SD_UPDATE,
                    Number(this.__ID),
                    this.getResData(),
                    this.getError()
                ])){
                    this.setStatus(Data.STATUS_RESPONSE);
                }else {
                    this.destroy('Send failed');
                }
            }).catch((e) => {
                this.destroy(e.message || 'Send failed');
            });
        });
        promise.catch(() => {});
        return promise;
    }

    /**
     *
     * @param status
     * @returns {boolean}
     */
    setStatus(status){
        if(
            (status !== Data.STATUS_SEND && status !== Data.STATUS_RESPONSE) ||
            this.__status === Data.STATUS_RESPONSE ||
            this.__status === status
        ){
            return false;
        }
        this.__status = status;
        this.emit('setStatus', status);
        if(status === Data.STATUS_RESPONSE){
            this.emit('response', this.getResData(), this.getError());
            this.destroy('response');
        }
        return true;
    }

    /**
     *
     * @param errorMsg
     * @returns {boolean}
     */
    setError(errorMsg){
        if(typeof errorMsg !== 'string'){
            return false;
        }
        this.__error = errorMsg;
        return true;
    }

    /**
     *
     * @param data
     * @returns {boolean}
     */
    setResData(data){
        if(typeof data !== 'object'){
            return false;
        }
        this.__resData = data;
        return true;
    }

    /**
     *
     * @param msg
     * @param isSetError
     * @returns {boolean}
     */
    destroy(msg, isSetError){
        if(this.__destroy){
            return false;
        }
        this.__destroy = typeof msg === 'string' && msg.length ? msg : 'destroy';
        clearTimeout(this.__ttlTimeout);
        if(isSetError && !this.__error){
            this.setError(this.__destroy);
        }
        if(this.__status !== Data.STATUS_RESPONSE){
            this.setStatus(Data.STATUS_RESPONSE);
        }
        this.emit('destroy', this.__destroy);
        this.clearAllListerens();
        return true;
    }
}
Data.STATUS_NEW      = 0;
Data.STATUS_SEND     = 1;
Data.STATUS_RESPONSE = 2;
Data.DEFAULT_TTL     = 3000;

class SocketObject extends EventEmitter {

    /**
     *
     * @param __ServerConfigure
     * @param __req
     */
    constructor(__ServerConfigure, __req){
        super();
        this.setMaxListeners(0);

        this.__serverConfigure = __ServerConfigure;
        this.__req             = __req;
        this.__ws              = undefined;
        this.__ID              = '';
        this.__sign            = '';
        this.__destroy         = undefined;
        this.__isNewConnection = true;
        this.__socketDataMap   = {};
        this.__socketDataInc   = 0;
        this.__query           = {};
        this.__timeOffset      = 0;

        this.on('destroy', this.__onDestroy);
        this.on('ws|disconnect', this.__onWsDisconnect);
        this.on('ws|connect', this.__onWsConnect);
        this.on('ws|message', this.__onWsMessage);
    }

    /**
     *
     * @returns {string}
     */
    getID(){
        return this.__ID || '';
    }

    /**
     *
     * @returns {string}
     */
    getSign(){
        return this.__sign || '';
    }

    /**
     *
     * @returns {number}
     */
    getTime(){
        return Date.now() + this.__timeOffset;
    }

    /**
     *
     * @returns {number}
     */
    getTimeOffset(){
        return this.__timeOffset;
    }

    /**
     *
     * @param timeOffset
     * @returns {boolean}
     */
    setTimeOffset(timeOffset){
        if(typeof timeOffset !== 'number' || timeOffset !== timeOffset){
            return false;
        }
        this.__timeOffset = Math.round(timeOffset);
        return true;
    }

    /**
     *
     * @returns {*|{}}
     */
    getReq(){
        return this.__req || {};
    }

    /**
     *
     * @returns {*}
     */
    getQuery(){
        return typeof this.__query === 'object' ? this.__query : {};
    }

    /**
     *
     * @param key
     * @param def
     * @returns {*}
     */
    getQueryVal(key, def){
        return this.getQuery()[key] || def;
    }

    /**
     *
     * @returns {*|{}}
     */
    getReqHeaders(){
        return this.getReq()['headers'] || {};
    }

    /**
     *
     * @returns {*|string}
     */
    getOrigin(){
        return this.getReqHeaders()['origin'] || 'unknown';
    }

    /**
     *
     * @returns {string}
     */
    getIP(){
        return String((this.getReq()['connection'] || {})['remoteAddress'] || 'unknown');
    }

    /**
     *
     * @returns {{}}
     */
    getSocketDataList(){
        return this.__socketDataMap;
    }

    /**
     *
     * @param ID
     * @returns {Data|boolean}
     */
    getSocketData(ID){
        return this.__socketDataMap[ID] || false;
    }

    /**
     *
     * @returns {boolean}
     */
    isConnection(){
        return typeof this.__ws === 'object' ? this.__ws.isConnection() : false;
    }

    /**
     *
     * @returns {any|boolean}
     */
    getConnection(){
        return this.isConnection() ? this.__ws : false;
    }

    /**
     *
     * @returns {string|boolean}
     */
    getDestroy(){
        return this.__destroy || false;
    }

    /**
     *
     * @returns {boolean}
     */
    isDestroy(){
        return !!this.getDestroy();
    }

    /**
     *
     * @returns {boolean}
     */
    isServer(){
        return !!this.__serverConfigure;
    }

    /**
     *
     * @returns {Promise}
     */
    getWsReady(){
        return new Promise((resolve, reject) => {
            if(this.getConnection()){
                return resolve(this.getConnection());
            }
            const destroyHandler = () => {
                this.off('connect', connectHandler);
                reject(new Error('destroy'));
            };
            const connectHandler = () => {
                this.off('destroy', destroyHandler);
                if(this.getConnection()){
                    resolve(this.getConnection());
                }else {
                    reject(new Error('Connection failed'));
                }
            };
            this.once('connect', connectHandler);
            this.once('destroy', destroyHandler);
        });
    }

    /**
     *
     * @param type
     * @param data
     * @param ttl
     * @returns {Promise<Data>}
     */
    send(type, data, ttl){
        const socketData = new Data(true, {
            'ID' : String(++this.__socketDataInc),
            'type' : type,
            'data' : data,
            'ttl' : ttl,
            'time' : this.getTime()
        }, this);
        if(socketData.getTTL()){
            this.__socketDataMap[socketData.getID()] = socketData;
            socketData.once('destroy', () => {
                delete this.__socketDataMap[socketData.getID()];
            });
        }
        this.getWsReady().then((ws) => {
            if(!ws.sendObject([
                MSG_SD_CREATE,
                Number(socketData.getID()),
                socketData.getType(),
                socketData.getTTL(),
                socketData.getData(),
                socketData.getTime()
            ])){
                return socketData.destroy('Send failed');
            }
            socketData.setStatus(socketData.getTTL() ? Data.STATUS_SEND : Data.STATUS_RESPONSE);
        }).catch((e) => {
            socketData.destroy(e.message || 'Send failed');
        });
        return Promise.resolve(socketData);
    }

    /**
     *
     * @param type
     * @param data
     * @param ttl
     * @returns {Promise<Data>}
     */
    sendReadyResponse(type, data, ttl){
        return this.send(type, data, ttl).then((socketData) => new Promise((resolve, reject) => {
            const responseHandler = () => {
                if(socketData.getError()){
                    return reject(new Error(socketData.getError()));
                }
                resolve(socketData);
            };
            if(socketData.isResponse() || socketData.getDestroy()){
                return responseHandler();
            }
            socketData.once('response', responseHandler);
        }));
    }

    /**
     *
     * @param type
     * @param data
     * @param ttl
     * @returns {Promise<Data>}
     */
    sendReady(type, data, ttl){
        return this.sendReadyResponse(type, data, ttl);
    }

    /**
     *
     * @param msg
     * @returns {boolean}
     */
    destroy(msg){
        if(this.isDestroy()){
            return false;
        }
        this.__destroy = String(msg || 'destroy');
        this.disconnect(this.__destroy);
        this.emit('destroy', this, this.__destroy);
        this.clearAllListerens();
        return true;
    }

    /**
     *
     * @param msg
     * @returns {boolean}
     */
    disconnect(msg){
        const ws = this.getConnection();
        if(!ws){
            return false;
        }
        return ws.closeConnection(msg);
    }

    /**
     *
     * @param ws
     * @returns {boolean}
     */
    update(ws){
        if(typeof ws !== 'object' || typeof ws.isConnection !== 'function' || typeof ws.query !== 'object'){
            return false;
        }
        if(!ws.isConnection() || this.__destroy){
            return false;
        }
        if(this.__ID !== ws.query['xSOId'] || this.__sign !== ws.query['xSOSign']){
            this.__ID    = ws.query['xSOId'];
            this.__sign  = ws.query['xSOSign'];
            this.__query = Object(ws['query'] || {});
            delete this.__query['xSOId'];
            delete this.__query['xSOSign'];
            delete this.__query['xV'];
            this.emit('update', this);
        }
        if(this.isServer()){
            ws.sendObject([
                MSG_SO_UPDATE,
                this.getID(),
                this.getSign(),
                typeof this.__serverConfigure === 'object' ? this.__serverConfigure : {},
                xSocket.VERSION,
                Date.now()
            ]);
        }else {
            this.setTimeOffset(ws.timeOffset);
            ws.sendObject([MSG_SO_TIME, Date.now()]);
        }
        this.__ws = ws;
        ws.SocketObject = this;
        this.emit('ws|connect', ws);
        return true;
    }

    __onDestroy(){
        for(const ID in this.__socketDataMap){
            this.__socketDataMap[ID].destroy('SocketObject|destroy');
        }
    }

    __onWsDisconnect(msg){
        msg = typeof msg === 'string' ? msg : 'unknown';
        this.emit('disconnect', this, msg);
        if(msg === 'end'){
            this.destroy('end');
        }
    }

    __onWsConnect(){
        this.emit('connect', this);
        if(!this.__isNewConnection){
            this.emit('reconnect', this);
        }else {
            this.__isNewConnection = false;
        }
    }

    __onWsMessage(body){
        if(body[0] === MSG_SO_TIME){
            return this.__onWsTime(body);
        }
        const ID = body[1];
        if(typeof ID !== 'number' || ID % 1 !== 0 || ID < 1){
            return;
        }
        let socketData;
        if(body[0] === MSG_SD_CREATE){
            if(typeof body[2] !== 'string' || !body[2].length || typeof body[4] !== 'object'){
                return;
            }
            socketData = new Data(false, {
                'ID' : String(ID),
                'type' : body[2],
                'ttl' : body[3],
                'data' : body[4],
                'time' : body[5]
            }, this);
            this.emit('data', socketData);
            this.emit('data|' + socketData.getType(), socketData);
            if(!socketData.getTTL()){
                socketData.setStatus(Data.STATUS_RESPONSE);
            }
        }else if(body[0] === MSG_SD_UPDATE){
            socketData = this.getSocketData(String(ID));
            if(socketData){
                socketData.setResData(body[2]);
                socketData.setError(body[3] || false);
                socketData.setStatus(Data.STATUS_RESPONSE);
            }
        }
    }

    __onWsTime(body){
        const ws = this.getConnection();
        if(!ws || typeof body[1] !== 'number'){
            return;
        }
        if(this.isServer()){
            ws.sendObject([MSG_SO_TIME, body[1], Date.now()]);
        }else if(typeof body[2] === 'number'){
            const now = Date.now();
            this.setTimeOffset(body[2] + (now - body[1]) / 2 - now);
        }
    }
}
SocketObject.MSG_SO_UPDATE = MSG_SO_UPDATE;
SocketObject.MSG_SD_CREATE = MSG_SD_CREATE;
SocketObject.MSG_SD_UPDATE = MSG_SD_UPDATE;
SocketObject.MSG_SO_TIME   = MSG_SO_TIME;

class Client extends EventEmitter {

    /**
     *
     * @param serverUrl
     * @param query
     * @param settings
     */
    constructor(serverUrl, query, settings){
        super();
        this.setMaxListeners(0);

        this.__urlList          = [];
        this.__ws               = undefined;
        this.__socketObject     = false;
        this.__isVersionWarned  = false;
        this.__settings         = typeof settings === 'object' && settings ? settings : {};
        this.__query            = typeof query === 'object' && query ? query : {};

        if(typeof serverUrl === 'object' && serverUrl){
            for(const i in serverUrl){
                this.__urlList.push(serverUrl[i]);
            }
        }else if(typeof serverUrl === 'string'){
            this.__urlList.push(serverUrl);
        }
        if(!this.__urlList.length){
            throw new Error('Invalid urlList');
        }
        const reconnect = () => {
            setTimeout(() => {
                this.getWs().catch(() => {});
            }, 1000);
        };
        this.on('ws|disconnect', reconnect);
        this.on('ws|error', reconnect);
        const closeConnection = () => {
            try{
                this.__ws.closeConnection('end');
            }catch (e){}
        };
        if(getWindow()){
            getWindow().addEventListener('pagehide', closeConnection);
            getWindow().addEventListener('unload', closeConnection);
        }else if(getProcess()){
            getProcess().on('exit', closeConnection);
        }
        this.on('connect', (socketObject) => {
            let destroyTimeout = false;
            const setDestroyTimeout = (action, ttl) => {
                if(destroyTimeout){
                    clearTimeout(destroyTimeout);
                    destroyTimeout = false;
                }
                if(action){
                    ttl = typeof ttl === 'number' && !isNaN(ttl) && ttl > 0 ? ttl : 0;
                    destroyTimeout = setTimeout(() => {
                        socketObject.destroy('socketObjectTimeout');
                        destroyTimeout = false;
                    }, ttl);
                }
            };
            socketObject.on('reconnect', () => {
                setDestroyTimeout(false);
            });
            socketObject.on('disconnect', () => {
                const socketObjectTimeout = parseInt(Object(socketObject.getQueryVal('configure', {}))['socketObjectTimeout'] || 0);
                if(typeof socketObjectTimeout === 'number'){
                    setDestroyTimeout(true, socketObjectTimeout);
                }
            });
            socketObject.once('destroy', () => {
                setDestroyTimeout(false);
            });
        });
        this.getWs().catch(() => {});
    }

    /**
     *
     * @returns {{}}
     */
    getSettings(){
        return this.__settings || {};
    }

    /**
     *
     * @param key
     * @param def
     * @returns {*}
     */
    getSettingsVal(key, def){
        return this.getSettings()[key] || def;
    }

    /**
     *
     * @returns {SocketObject|boolean}
     */
    getSocketObject(){
        return this.__socketObject;
    }

    /**
     *
     * @returns {Promise<SocketObject>}
     */
    getSocketObjectReady(){
        return new Promise((resolve) => {
            if(this.getSocketObject()){
                return resolve(this.getSocketObject());
            }
            this.once('connect', (socketObject) => {
                resolve(socketObject);
            });
        });
    }

    /**
     *
     * @returns {Promise<{}>}
     */
    getWs(){
        return new Promise((resolve) => {
            if(typeof this.__ws === 'object'){
                return resolve(this.__ws);
            }
            this.__ws = null;
            let url = this.__urlList[getRandInt(0, this.__urlList.length - 1)];
            url += (url.indexOf('?') === -1 ? '?' : '&');

            const query = this.__query;
            query['xV'] = xSocket.VERSION;
            if(this.__socketObject && this.__socketObject.getID().length && this.__socketObject.getSign().length){
                query['xSOId'] = String(this.__socketObject.getID());
                query['xSOSign'] = String(this.__socketObject.getSign());
            }
            for(const i in query){
                try{
                    url += encodeURIComponent(String(i)) + '=' + encodeURIComponent(String(query[i])) + '&';
                }catch (e){}
            }

            const ws = new xSocket.WebSocket(url);
            ws.binaryType = 'arraybuffer';
            ws.isConnection = () => ws.readyState === 1;
            ws.closeConnection = (msg) => {
                if(ws.isConnection()){
                    try{
                        ws.close(1000, String(msg || 'close'));
                        return true;
                    }catch (e){
                        console.error(e);
                    }
                }
                return false;
            };
            ws.sendMessage = (msg) => {
                try{
                    if(ws.isConnection()){
                        ws.send(String(msg));
                        return true;
                    }
                }catch (e){}
                return false;
            };
            ws.sendObject = (object) => {
                try{
                    if(ws.isConnection()){
                        ws.send(encodeMessage(object));
                        return true;
                    }
                }catch (e){}
                return false;
            };
            let closeMsg;
            let msgInc = 0;
            let pongInterval = false;
            ws.onopen = () => {
                this.__ws = ws;
                this.emit('ws|connect', ws);
                pongInterval = setInterval(() => {
                    if(!msgInc){
                        ws.closeConnection('pingTimeout');
                    }
                    msgInc = 0;
                }, 21000);
                resolve(ws);
            };
            ws.onmessage = (e) => {
                msgInc++;
                if(e.data === 'ping'){
                    return ws.sendMessage('pong');
                }
                try{
                    const body = decodeMessage(e.data);
                    if(!body){
                        return;
                    }
                    if(body[0] === MSG_SO_UPDATE){
                        this.__onSocketObjectUpdate(ws, body);
                    }else if(this.__socketObject){
                        this.__socketObject.emit('ws|message', body);
                    }
                }catch (e){}
            };
            ws.onclose = (e) => {
                if(pongInterval){
                    clearInterval(pongInterval);
                }
                this.__ws = undefined;
                closeMsg = closeMsg || e.reason || 'close';
                this.emit('ws|disconnect', closeMsg);
                if(this.__socketObject){
                    this.__socketObject.emit('ws|disconnect', closeMsg);
                }
            };
            ws.onerror = (e) => {
                closeMsg = e.message;
                this.emit('ws|error', e.message, ws);
            };
        });
    }

    /**
     *
     * @param type
     * @param data
     * @param ttl
     * @returns {Promise<Data>}
     */
    send(type, data, ttl){
        return this.getSocketObjectReady().then((socketObject) => socketObject.send(type, data, ttl));
    }

    /**
     *
     * @param type
     * @param data
     * @param ttl
     * @returns {Promise<Data>}
     */
    sendReady(type, data, ttl){
        return this.getSocketObjectReady().then((socketObject) => socketObject.sendReady(type, data, ttl));
    }

    /**
     *
     * @param type
     * @param data
     * @param ttl
     * @returns {Promise<Data>}
     */
    sendReadyResponse(type, data, ttl){
        return this.sendReady(type, data, ttl);
    }

    /**
     *
     * @param msg
     * @returns {boolean}
     */
    disconnect(msg){
        const socketObject = this.getSocketObject();
        if(!socketObject){
            return false;
        }
        return socketObject.disconnect(msg);
    }

    __onSocketObjectUpdate(ws, body){
        if(body[4] !== xSocket.VERSION && !this.__isVersionWarned){
            this.__isVersionWarned = true;
            console.warn('[warn|xSocket]', 'Version mismatch', 'client ' + xSocket.VERSION + ', server ' + (body[4] || 'unknown'));
        }
        ws.timeOffset = typeof body[5] === 'number' ? body[5] - Date.now() : 0;
        ws.query = {
            'xSOId' : String(body[1]),
            'xSOSign' : String(body[2]),
            'configure' : typeof body[3] === 'object' ? body[3] : {}
        };
        if(this.__socketObject){
            if(ws.query['xSOId'] === this.__socketObject.getID() && ws.query['xSOSign'] === this.__socketObject.getSign() && this.__socketObject.update(ws)){
                return;
            }
            this.__socketObject.destroy('update');
        }
        const socketObject = this.__socketObject = new SocketObject();
        socketObject.once('connect', () => {
            this.emit('connect', socketObject);
        });
        socketObject.on('destroy', (socketObject, msg) => {
            this.__socketObject = false;
            this.emit('destroy', socketObject, msg);
        });
        socketObject.on('disconnect', (socketObject, msg) => {
            this.emit('disconnect', socketObject, msg);
        });
        socketObject.on('reconnect', () => {
            this.emit('reconnect', socketObject);
        });
        socketObject.on('data', (socketData) => {
            this.emit('data', socketData);
        });
        if(!socketObject.update(ws)){
            ws.closeConnection('update');
        }
    }
}

xSocket.helpers       = helpers;
xSocket.EventEmitter  = EventEmitter;
xSocket.Data          = Data;
xSocket.xSocketObject = SocketObject;
xSocket.Client        = Client;

xSocket.VERSION;

const REQUEST_TTL = 20000;
const EARLY_MESSAGE_TTL = 10000;
const MEDIA_TYPE_LIST = ['media.signal', 'media.status', 'media.closed', 'media.stat'];
const DEFAULT_STUN_URL = 'stun:stun.xiomb.com:3478';
const TRANSPORT_NAME_MAP = {webrtc: 'WebRTC', hls: 'HLS'};

class xiomb extends xiombEmitter {
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

export { xiomb, xiombEmitter, xiombError, xiombHlsSession, xiombObject, xiombPlayer, xiombSession, xiombStat };
