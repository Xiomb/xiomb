import {xiombEmitter} from "./xiombEmitter.js";
import {xiombError} from "./xiombError.js";

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

export class xiombPlayer extends xiombEmitter {
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
