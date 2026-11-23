import {xiombEmitter} from "./xiombEmitter.js";
import {xiombError} from "./xiombError.js";
import {xiombRestart} from "./xiombRestart.js";

const RENEGOTIATE_RETRY_MIN = 1000;
const RENEGOTIATE_RETRY_MAX = 5000;
export const SERVICE_CODEC_LIST = ['RTX', 'RED', 'ULPFEC', 'FLEXFEC-03', 'CN', 'TELEPHONE-EVENT'];

export class xiombSession extends xiombEmitter {
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
    #retryDelay = RENEGOTIATE_RETRY_MIN;
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
            this.#retryDelay = RENEGOTIATE_RETRY_MIN;
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
            this.#retryDelay = Math.min(this.#retryDelay * 2, RENEGOTIATE_RETRY_MAX);
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
