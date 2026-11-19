import ObjectExtend from "./ObjectExtend.js";

const STATUS = Object.freeze({
    MEDIA_STATUS_CONNECT: 'connect',
    MEDIA_STATUS_PUBLISH: 'publish',
    MEDIA_STATUS_PLAY: 'play',
    MEDIA_STATUS_RECONNECT: 'reconnect',
    MEDIA_STATUS_STOP: 'stop',
    MEDIA_STATUS_PUSH: 'push',
});

export class MediaObject extends ObjectExtend {
    #ID;
    #sessionID;
    #name;
    #direction;
    #transport;
    #userID;
    #data;
    #playURL;
    #snapshotURL;
    #clientAddress;
    #userAgent;
    #status = 'connect';
    #renegotiate = false;
    #client = null;
    #mediaApp;
    #stat = null;

    constructor({ID, sessionID = '', name, direction, transport = 'webrtc', userID = '', data = null, playURL = '', snapshotURL = '',
        clientAddress = '', userAgent = ''}, mediaApp = null) {
        super();
        this.#mediaApp = mediaApp;
        this.#ID = ID;
        this.#sessionID = sessionID;
        this.#name = name;
        this.#direction = direction;
        this.#transport = transport;
        this.#userID = userID;
        this.#data = data;
        this.#playURL = playURL;
        this.#snapshotURL = snapshotURL;
        this.#clientAddress = clientAddress;
        this.#userAgent = userAgent;
    }

    toString() {
        return `Media(${this.#ID} ${this.#direction} ${this.#name})`;
    }

    getID() {
        return this.#ID;
    }

    getSessionID() {
        return this.#sessionID;
    }

    getName() {
        return this.#name;
    }

    getDirection() {
        return this.#direction;
    }

    getTransport() {
        return this.#transport;
    }

    getUserID() {
        return this.#userID;
    }

    // адрес клиента: браузер, плеер, камера; пусто — неизвестен
    getClientAddress() {
        return this.#clientAddress;
    }

    // User-Agent браузера или плеера, flashVer RTMP-клиента; пусто — неизвестен
    getUserAgent() {
        return this.#userAgent;
    }

    getData() {
        return this.#data;
    }

    getPlayURL() {
        return this.#playURL;
    }

    setPlayURL(playURL) {
        this.#playURL = playURL;
    }

    getSnapshotURL() {
        return this.#snapshotURL;
    }

    setSnapshotURL(snapshotURL) {
        if (!snapshotURL || snapshotURL === this.#snapshotURL) {
            return;
        }
        this.#snapshotURL = snapshotURL;
        this.emit('snapshot', snapshotURL);
    }

    getStatus() {
        return this.#status;
    }

    isRenegotiate() {
        return this.#renegotiate;
    }

    setStatus(status, renegotiate) {
        const next = STATUS[status] ?? this.#status;
        if (next === this.#status && renegotiate === this.#renegotiate) {
            return false;
        }
        this.#status = next;
        this.#renegotiate = renegotiate;
        this.emit('status', this);
        return true;
    }

    getClient() {
        return this.#client;
    }

    setClient(client) {
        this.#client?.deleteMediaObject(this.#ID);
        this.#client = client;
        client?.setMediaObject(this);
    }

    getInfo() {
        return {
            ID: this.#ID,
            name: this.#name,
            direction: this.#direction,
            transport: this.#transport,
            playURL: this.#playURL,
            status: this.#status,
            renegotiate: this.#renegotiate,
        };
    }

    async getStat() {
        this.setStat(await this.#mediaApp.loadMediaStats(this.#ID));
        return this.#stat;
    }

    getLastStat() {
        return this.#stat;
    }

    setStat(mediaStats) {
        this.#stat = {
            ID: this.#ID,
            measuredAt: mediaStats.measured_unix_ms || null,
            trackList: (mediaStats.tracks ?? []).map(track => ({
                kind: track.kind,
                codec: track.codec,
                width: track.width,
                height: track.height,
                fps: track.fps,
                bitrate: track.bitrate_bps,
                packetsLost: track.packets_lost,
                dropped: track.dropped,
                live: track.live,
                transcodedFrom: track.transcoded_from,
            })),
            transcoderList: (mediaStats.transcoders ?? []).map(transcoder => ({
                kind: transcoder.kind,
                from: transcoder.from,
                to: transcoder.to,
                bitrate: transcoder.bitrate_bps,
                fps: transcoder.fps,
                viewers: transcoder.viewers,
            })),
            recording: !!mediaStats.recording,
            viewers: mediaStats.viewers ?? 0,
        };
        this.emit('stat', this.#stat);
    }

    #track(kind) {
        return this.#stat?.trackList.find(track => track.kind === kind) ?? null;
    }

    #sum(field) {
        return this.#stat ? this.#stat.trackList.reduce((sum, track) => sum + (track[field] || 0), 0) : null;
    }

    getStatAt() {
        return this.#stat?.measuredAt ?? null;
    }

    getFPS() {
        return this.#track('video')?.fps ?? null;
    }

    getVideoWidth() {
        return this.#track('video')?.width ?? null;
    }

    getVideoHeight() {
        return this.#track('video')?.height ?? null;
    }

    getVideoCodec() {
        return this.#track('video')?.codec ?? null;
    }

    getAudioCodec() {
        return this.#track('audio')?.codec ?? null;
    }

    getVideoBitrate() {
        return this.#track('video')?.bitrate ?? null;
    }

    getAudioBitrate() {
        return this.#track('audio')?.bitrate ?? null;
    }

    getBitrate() {
        return this.#sum('bitrate');
    }

    getPacketsLost() {
        return this.#sum('packetsLost');
    }

    getDropped() {
        return this.#sum('dropped');
    }

    isLive() {
        return this.#stat ? this.#stat.trackList.some(track => track.live) : null;
    }

    isRecording() {
        return this.#stat?.recording ?? null;
    }

    getViewerCount() {
        return this.#stat ? this.#stat.viewers : null;
    }

    getTranscoderList() {
        return this.#stat?.transcoderList ?? [];
    }

    async destroy(destroyMessage) {
        this.#status = 'stop';
        this.setClient(null);
        return super.destroy(destroyMessage);
    }
}
