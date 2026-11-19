import ObjectExtend from "./ObjectExtend.js";
import {MediaObject} from "./MediaObject.js";
import {ProjectError} from "./ProjectError.js";
import {decodeData} from "./Data.js";

const EARLY_TTL = 10000;
// медиа браузера: после рестарта проекта ждут media.resume
const CLIENT_TRANSPORT_LIST = ['TRANSPORT_WEBRTC', 'TRANSPORT_HLS'];
const DIRECTION_MAP = new Map([['DIRECTION_PUBLISH', 'publish'], ['DIRECTION_PLAY', 'play'], ['DIRECTION_PUSH', 'push']]);

export class Media extends ObjectExtend {
    #project;
    #mediaObjectMap = new Map();
    #earlyEventMap = new Map();
    #resumeTimerMap = new Map();
    #closingMediaIDSet = new Set();

    constructor(project) {
        super();
        this.#project = project;
    }

    getMediaObject(ID) {
        return this.#mediaObjectMap.get(ID) ?? null;
    }

    getMediaObjectList() {
        return [...this.#mediaObjectMap.values()];
    }

    addMediaObject(fields, client = null) {
        const mediaObject = new MediaObject(fields, this);
        this.#mediaObjectMap.set(mediaObject.getID(), mediaObject);
        mediaObject.setClient(client);
        this.#project.emit('media', mediaObject);

        const early = this.#earlyEventMap.get(mediaObject.getID());
        if (early) {
            clearTimeout(early.timer);
            this.#earlyEventMap.delete(mediaObject.getID());
            for (const event of early.events) {
                event();
            }
        }
        return mediaObject;
    }

    #addFromState(state) {
        const mediaObject = this.addMediaObject({
            ID: state.media_id,
            name: state.name,
            direction: DIRECTION_MAP.get(state.direction) ?? 'play',
            transport: String(state.transport).replace('TRANSPORT_', '').toLowerCase(),
            userID: state.user_id,
            data: decodeData(state.data),
            playURL: state.play_url,
            snapshotURL: state.snapshot_url,
            clientAddress: state.client_address ?? '',
            userAgent: state.user_agent ?? '',
        });
        mediaObject.setStatus(state.status, state.renegotiate);
        return mediaObject;
    }

    removeMediaObject(mediaObject, reason = null, notify = true) {
        if (this.#mediaObjectMap.get(mediaObject.getID()) !== mediaObject) {
            return;
        }
        this.#mediaObjectMap.delete(mediaObject.getID());
        clearTimeout(this.#resumeTimerMap.get(mediaObject.getID()));
        this.#resumeTimerMap.delete(mediaObject.getID());
        if (notify) {
            mediaObject.getClient()?.sendClosed(mediaObject, reason);
        }
        mediaObject.destroy(reason ? reason.name : 'closed').catch(() => {});
        this.#project.emit('media|destroy', mediaObject, reason?.toPublic() ?? null);
    }

    async closeMediaObject(mediaObject, reason = null, notify = true) {
        this.removeMediaObject(mediaObject, reason, notify);
        try {
            await this.#project.getCoreLink().closeMedia(mediaObject.getID(), reason ? {name: reason.name, message: ''} : null);
        } catch (e) {
            this.#closingMediaIDSet.add(mediaObject.getID());
            this.#project.log('debug', `${mediaObject}: close in core failed: ${e.name}`);
        }
    }

    async destroy(destroyMessage) {
        for (const timer of this.#resumeTimerMap.values()) {
            clearTimeout(timer);
        }
        this.#resumeTimerMap.clear();
        return super.destroy(destroyMessage);
    }

    isWaitingResume(ID) {
        return this.#resumeTimerMap.has(ID);
    }

    claimMediaObject(ID) {
        if (!this.#resumeTimerMap.has(ID)) {
            return null;
        }
        clearTimeout(this.#resumeTimerMap.get(ID));
        this.#resumeTimerMap.delete(ID);
        return this.getMediaObject(ID);
    }

    #waitResume(mediaObject) {
        const timer = setTimeout(() => {
            this.#resumeTimerMap.delete(mediaObject.getID());
            this.#project.log('debug', `${mediaObject}: not resumed, closing`);
            this.closeMediaObject(mediaObject, null, false);
        }, this.#project.getSettings().resumeTimeout);
        timer.unref();
        this.#resumeTimerMap.set(mediaObject.getID(), timer);
    }

    async sync() {
        const core = this.#project.getCoreLink();
        const mediaStateMap = new Map((await core.listMedia()).map(state => [state.media_id, state]));
        const result = {closed: 0, orphaned: 0, updated: 0, added: 0, waiting: 0};
        for (const mediaObject of this.getMediaObjectList()) {
            const state = mediaStateMap.get(mediaObject.getID());
            if (!state) {
                this.removeMediaObject(mediaObject, new ProjectError('MEDIA_TERMINATED'));
                result.closed++;
            } else {
                mediaObject.setSnapshotURL(state.snapshot_url);
                if (mediaObject.setStatus(state.status, state.renegotiate)) {
                    mediaObject.getClient()?.sendStatus(mediaObject, null);
                    result.updated++;
                }
            }
        }
        const closingMediaIDSet = this.#closingMediaIDSet;
        this.#closingMediaIDSet = new Set();
        for (const [mediaID, state] of mediaStateMap) {
            if (this.#mediaObjectMap.has(mediaID)) {
                continue;
            }
            if (!CLIENT_TRANSPORT_LIST.includes(state.transport)) {
                this.#addFromState(state);
                result.added++;
            } else if (closingMediaIDSet.has(mediaID) || !this.#project.getSettings().resumeTimeout) {
                core.closeMedia(mediaID, null).catch(() => {});
                result.orphaned++;
            } else {
                this.#waitResume(this.#addFromState(state));
                result.waiting++;
            }
        }
        if (Object.values(result).some(Boolean)) {
            this.#project.log('system', `core: media synced — closed ${result.closed}, orphaned in core ${result.orphaned}, status updated ${result.updated}, added ${result.added}, waiting for resume ${result.waiting}`);
        }
        return result;
    }

    #withMedia(mediaID, event) {
        const mediaObject = this.#mediaObjectMap.get(mediaID);
        if (mediaObject) {
            event(mediaObject);
            return;
        }
        let early = this.#earlyEventMap.get(mediaID);
        if (!early) {
            early = {events: [], timer: setTimeout(() => this.#earlyEventMap.delete(mediaID), EARLY_TTL)};
            early.timer.unref();
            this.#earlyEventMap.set(mediaID, early);
        }
        early.events.push(() => this.#withMedia(mediaID, event));
    }

    loadMediaStats(ID) {
        return this.#project.getCoreLink().getMediaStats(ID);
    }

    coreStats(mediaStatsList) {
        for (const mediaStats of mediaStatsList) {
            const mediaObject = this.#mediaObjectMap.get(mediaStats.media_id);
            if (mediaObject) {
                mediaObject.setStat(mediaStats);
                mediaObject.getClient()?.sendStat(mediaObject);
            }
        }
    }

    coreOpened(state) {
        if (!this.#mediaObjectMap.has(state.media_id)) {
            this.#addFromState(state);
        }
    }

    coreSnapshot(mediaID, url) {
        this.#withMedia(mediaID, mediaObject => mediaObject.setSnapshotURL(url));
    }

    coreSignal(signal) {
        this.#withMedia(signal.media_id, mediaObject => mediaObject.getClient()?.sendSignal(mediaObject, signal));
    }

    coreStatus(mediaID, status, renegotiate, reason) {
        this.#withMedia(mediaID, mediaObject => {
            if (mediaObject.setStatus(status, renegotiate)) {
                mediaObject.getClient()?.sendStatus(mediaObject, reason);
            }
        });
    }

    coreClosed(mediaID, reason) {
        this.#withMedia(mediaID, mediaObject => this.removeMediaObject(mediaObject, reason));
    }
}
