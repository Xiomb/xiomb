import {xiombEmitter} from "./xiombEmitter.js";
import {xiombError} from "./xiombError.js";
import {xiombStat} from "./xiombStat.js";

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

export class xiombObject extends xiombEmitter {
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
