const PUBLIC = Object.freeze({
    BAD_REQUEST: 'Bad request',
    FORBIDDEN: 'Forbidden',
    MEDIA_NOT_FOUND: 'Media not found',
    TIMEOUT: 'Timeout',
    INTERNAL: 'Internal error',
    STREAM_NAME_TAKEN: 'Stream name taken',
    STREAM_NOT_FOUND: 'Stream not found',
    STREAM_NAME_INVALID: 'Invalid stream name',
    STREAM_ENDED: 'Stream ended',
    STREAM_NOT_READY: 'Stream not ready',
    CODEC_UNSUPPORTED: 'Codec unsupported',
    SDP_INVALID: 'Invalid SDP',
    MEDIA_TERMINATED: 'Media terminated',
    MEDIA_MOVED: 'Media moved',
    CAPACITY_EXHAUSTED: 'No capacity',
    SERVICE_UNAVAILABLE: 'Service unavailable',
    URI_INVALID: 'Invalid uri',
    PULL_FAILED: 'Pull failed',
    PUSH_FAILED: 'Push failed',
    LINK_NOT_SET: 'Link not set',
});

const BROWSER_NAMES = Object.freeze({
    CORE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
});

export class ProjectError extends Error {
    code;
    #custom = false;

    constructor(name, message, code = 0) {
        super(message || PUBLIC[name] || name);
        this.name = name;
        this.code = code;
    }

    static from(e) {
        return e instanceof ProjectError ? e : new ProjectError('INTERNAL', e?.message);
    }

    static fromProto(error) {
        if (!error || (!error.name && !error.code && !error.message)) {
            return null;
        }
        return new ProjectError(error.name || 'INTERNAL', error.message, error.code);
    }

    setCustom() {
        this.#custom = true;
        return this;
    }

    toPublic() {
        if (this.#custom) {
            return {name: this.name, message: this.message};
        }
        const mapped = BROWSER_NAMES[this.name] ?? this.name;
        const name = PUBLIC[mapped] ? mapped : 'INTERNAL';
        return {name, message: PUBLIC[name]};
    }
}
