// MEDIA_NOT_FOUND — сервер проекта после перезапуска не знает медиа (ответ media.resume)
const RESTART_REASON_LIST = ['SERVICE_UNAVAILABLE', 'MEDIA_TERMINATED', 'SESSION_RESET', 'MEDIA_NOT_FOUND'];
const PLAY_RESTART_REASON_LIST = ['STREAM_ENDED', 'STREAM_NOT_FOUND', 'STREAM_NOT_READY'];
const START_RETRY_REASON_LIST = ['NOT_CONNECTED', 'TIMEOUT'];
const RESTART_DELAY_MIN = 1000;
const RESTART_DELAY_MAX = 10000;

/**
 * Перезапуск сессии после закрытия по причине, которую стоит повторить: переезд проекта на другое ядро и т.п.
 */
export class xiombRestart {
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
