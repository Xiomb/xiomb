import {xiombEmitter} from "./xiombEmitter.js";
import {xiombError} from "./xiombError.js";
import {xiombRestart} from "./xiombRestart.js";

const RENEGOTIATE_RETRY_MIN = 1000;
const RENEGOTIATE_RETRY_MAX = 5000;

export class xiombHlsSession extends xiombEmitter {
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
