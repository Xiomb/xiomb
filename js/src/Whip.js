import {ProjectError} from "./ProjectError.js";
import {UrlSocket, UrlClient} from "./UrlClient.js";
import {encodeData} from "./Data.js";

const TRANSPORT = 'webrtc_obs';
const PUBLISH_PATH = /^\/whip\/([A-Za-z0-9_-]{1,50})\/?$/;
const RESOURCE_PATH = /^\/whip\/resource\/([0-9A-Za-z-]{1,64})\/?$/;
const MAX_SDP = 64 * 1024;
// xSocket сам отвечает 404 через 5 с: ответ — раньше
const ANSWER_TIMEOUT = 4500;
// после последнего кандидата ICE ждём ещё столько
const CANDIDATE_QUIET = 300;
const PARAM_NAME = /^[A-Za-z0-9_]{1,32}$/;
const MAX_PARAMS = 16;
const MAX_PARAM_VALUE = 512;
const HEADER_MAP = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match',
    'Access-Control-Expose-Headers': 'Location, ETag',
};

/**
 * Публикация OBS по WHIP: SDP и кандидаты ICE в одном HTTP-ответе
 */
export class WhipClient extends UrlClient {
    #mediaObjectMap = new Map();
    #answer = null;
    #candidateList = [];
    #ended = false;
    #lastSignalAt = 0;
    #wake = null;

    setMediaObject(mediaObject) {
        this.#mediaObjectMap.set(mediaObject.getID(), mediaObject);
    }

    deleteMediaObject(ID) {
        this.#mediaObjectMap.delete(ID);
    }

    getMediaObjectList() {
        return [...this.#mediaObjectMap.values()];
    }

    sendSignal(mediaObject, signal) {
        if (signal.description?.type === 'answer') {
            this.#answer = signal.description.sdp;
        } else if (signal.candidate) {
            const candidate = String(signal.candidate.candidate ?? '').trim();
            if (candidate) {
                this.#candidateList.push({candidate: candidate.replace(/^a=/, ''), index: signal.candidate.sdp_mline_index | 0});
            } else {
                this.#ended = true;
            }
        }
        this.#lastSignalAt = Date.now();
        this.#wake?.();
    }

    sendStatus() {}

    sendStat() {}

    sendClosed() {}

    /**
     * @param deadline Date.now(), до которого ждать
     * @returns {Promise<string>} answer с кандидатами ICE
     */
    async waitAnswer(deadline) {
        while (Date.now() < deadline) {
            const quiet = this.#candidateList.length && Date.now() - this.#lastSignalAt >= CANDIDATE_QUIET;
            if (this.#answer && (this.#ended || quiet)) {
                break;
            }
            await new Promise(resolve => {
                const timer = setTimeout(resolve, Math.min(CANDIDATE_QUIET, Math.max(0, deadline - Date.now())));
                this.#wake = () => {
                    clearTimeout(timer);
                    resolve();
                };
            });
            this.#wake = null;
        }
        if (!this.#answer) {
            throw new ProjectError('TIMEOUT');
        }
        return WhipClient.#withCandidates(this.#answer, this.#candidateList);
    }

    /**
     * Кандидаты ICE — в секции m= своего индекса
     */
    static #withCandidates(sdp, candidateList) {
        const lineList = sdp.split(/\r?\n/).filter(line => line && !line.startsWith('a=end-of-candidates'));
        const sectionList = [[]];
        for (const line of lineList) {
            if (line.startsWith('m=')) {
                sectionList.push([]);
            }
            sectionList[sectionList.length - 1].push(line);
        }
        const existing = new Set(lineList.filter(line => line.startsWith('a=candidate:')));
        for (let index = 1; index < sectionList.length; index++) {
            for (const {candidate} of candidateList.filter(item => item.index === index - 1)) {
                if (!existing.has(`a=${candidate}`)) {
                    sectionList[index].push(`a=${candidate}`);
                }
            }
            sectionList[index].push('a=end-of-candidates');
        }
        return sectionList.flat().join('\r\n') + '\r\n';
    }
}

/**
 * WHIP на порту сокета проекта: POST /whip/<поток> — публикация, DELETE /whip/resource/<mediaID> — стоп.
 * Логин и пароль: auth_login и auth_password в адресе, Bearer — auth_password
 */
export class Whip {
    #project;

    constructor(project) {
        this.#project = project;
    }

    /**
     * @param req
     * @param res
     * @returns {boolean} запрос WHIP
     */
    handle(req, res) {
        const url = new URL(req.url ?? '/', 'https://localhost');
        if (!url.pathname.startsWith('/whip/')) {
            return false;
        }
        this.#route(req, res, url).catch(e => {
            const error = ProjectError.from(e);
            if (error.name === 'INTERNAL') {
                this.#project.log('error', `whip: ${e?.stack ?? e}`);
            }
            this.#reply(res, Whip.#statusFor(error.name), {'Content-Type': 'text/plain'}, error.name);
        });
        return true;
    }

    async #route(req, res, url) {
        if (req.method === 'OPTIONS') {
            return this.#reply(res, 204);
        }
        const publishMatch = PUBLISH_PATH.exec(url.pathname);
        if (publishMatch && req.method === 'POST') {
            return this.#publish(req, res, url, publishMatch[1]);
        }
        const resourceMatch = RESOURCE_PATH.exec(url.pathname);
        if (resourceMatch && req.method === 'DELETE') {
            return this.#stop(res, resourceMatch[1]);
        }
        if (resourceMatch && req.method === 'PATCH') {
            return this.#trickle(req, res, resourceMatch[1]);
        }
        throw new ProjectError(publishMatch || resourceMatch ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND');
    }

    async #publish(req, res, url, name) {
        const deadline = Date.now() + ANSWER_TIMEOUT;
        if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/sdp')) {
            throw new ProjectError('BAD_REQUEST');
        }
        const sdp = await Whip.#body(req);
        if (!sdp.startsWith('v=0')) {
            throw new ProjectError('BAD_REQUEST');
        }
        const paramMap = Whip.#params(url.searchParams);
        const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1]?.trim();
        if (bearer && !('auth_password' in paramMap)) {
            paramMap.auth_password = bearer.slice(0, MAX_PARAM_VALUE);
        }
        const address = String(req.socket.remoteAddress ?? '').replace(/^::ffff:(?=\d+\.)/, '');
        const userAgent = String(req.headers['user-agent'] ?? '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 512);

        const socket = new UrlSocket(paramMap, address, userAgent);
        const {user, data} = await this.#allow(socket, name, paramMap, address, userAgent);
        const client = new WhipClient(user, socket, TRANSPORT);
        const created = await this.#project.getCoreLink().publish({
            client_id: client.getID(),
            user_id: client.getUserID(),
            name,
            offer: {type: 'offer', sdp},
            client_address: address,
            user_agent: userAgent,
            data: data === undefined ? '' : encodeData(data),
            transport: 'TRANSPORT_WEBRTC_OBS',
        });
        const mediaApp = this.#project.getMediaApp();
        const mediaObject = mediaApp.addMediaObject({
            ID: created.media_id,
            sessionID: created.session_id,
            name,
            direction: 'publish',
            transport: TRANSPORT,
            userID: client.getUserID(),
            data,
            playURL: '',
            clientAddress: address,
            userAgent,
        }, client);
        let answer;
        try {
            answer = await client.waitAnswer(deadline);
        } catch (e) {
            mediaApp.closeMediaObject(mediaObject, null, false).catch(() => {});
            throw e;
        }
        this.#project.log('debug', `whip: publish ${name} -> ${mediaObject.getID()} from ${address}`);
        this.#reply(res, 201, {
            'Content-Type': 'application/sdp',
            'Location': `/whip/resource/${mediaObject.getID()}`,
            'ETag': `"${mediaObject.getID()}"`,
        }, answer);
    }

    /**
     * Хуки как у RTSP и RTMP: старый rtsp или auth, затем publish
     * @returns {Promise<{user: *, data: *}>}
     */
    async #allow(socket, name, paramMap, address, userAgent) {
        const project = this.#project;
        try {
            if (project.hasHook('rtsp')) {
                const allowed = await project.callHook('rtsp', {
                    userID: paramMap.auth_login ?? '',
                    token: paramMap.auth_password ?? '',
                    name,
                    direction: 'publish',
                    transport: TRANSPORT,
                    remoteAddress: address,
                    userAgent,
                    params: {...paramMap},
                });
                return {user: {ID: paramMap.auth_login ?? ''}, data: typeof allowed === 'object' ? allowed.data : undefined};
            }
            const user = await project.callHook('auth', socket);
            const client = new UrlClient(user, socket, TRANSPORT);
            const allowed = await project.callHook('publish', client, {name, transport: TRANSPORT, custom: {}});
            // имя потока задано адресом: другое имя от хука не принимаем
            const renamed = typeof allowed === 'string' ? allowed : typeof allowed === 'object' ? allowed.name : undefined;
            if ((allowed !== true && typeof allowed !== 'object' && typeof allowed !== 'string') || (renamed && renamed !== name)) {
                throw new ProjectError('FORBIDDEN');
            }
            return {user, data: typeof allowed === 'object' && 'data' in allowed ? allowed.data : user?.data};
        } catch (e) {
            if (!(e instanceof ProjectError)) {
                project.log('error', `hook ${TRANSPORT} publish: ${e?.message ?? e}`);
            }
            project.log('debug', `whip: publish ${name} from ${address} denied`);
            throw new ProjectError('FORBIDDEN');
        }
    }

    async #stop(res, mediaID) {
        const mediaApp = this.#project.getMediaApp();
        const mediaObject = mediaApp.getMediaObject(mediaID);
        if (!mediaObject || mediaObject.getTransport() !== TRANSPORT) {
            throw new ProjectError('NOT_FOUND');
        }
        await mediaApp.closeMediaObject(mediaObject, null, false);
        this.#project.log('debug', `whip: ${mediaObject} stopped by the client`);
        this.#reply(res, 200);
    }

    /**
     * Trickle ICE от клиента: a=candidate из тела PATCH — на ноду
     */
    async #trickle(req, res, mediaID) {
        const mediaObject = this.#project.getMediaApp().getMediaObject(mediaID);
        if (!mediaObject || mediaObject.getTransport() !== TRANSPORT) {
            throw new ProjectError('NOT_FOUND');
        }
        const body = await Whip.#body(req);
        let index = -1;
        for (const line of body.split(/\r?\n/)) {
            if (line.startsWith('m=')) {
                index++;
            } else if (line.startsWith('a=candidate:') && line.length <= 2048) {
                this.#project.getCoreLink().signal({media_id: mediaID, candidate: {candidate: line.slice(2), sdp_mline_index: Math.max(0, index)}});
            }
        }
        this.#reply(res, 204);
    }

    static #params(searchParams) {
        const paramMap = {};
        for (const [name, value] of searchParams) {
            if (Object.keys(paramMap).length >= MAX_PARAMS) {
                break;
            }
            if (PARAM_NAME.test(name) && value.length <= MAX_PARAM_VALUE && !/[\x00-\x1f\x7f]/.test(value)) {
                paramMap[name] = value;
            }
        }
        return paramMap;
    }

    static #body(req) {
        return new Promise((resolve, reject) => {
            const chunkList = [];
            let size = 0;
            req.on('data', chunk => {
                size += chunk.length;
                if (size > MAX_SDP) {
                    req.destroy();
                    reject(new ProjectError('BAD_REQUEST'));
                    return;
                }
                chunkList.push(chunk);
            });
            req.on('end', () => resolve(Buffer.concat(chunkList).toString('utf8')));
            req.on('error', () => reject(new ProjectError('BAD_REQUEST')));
        });
    }

    static #statusFor(name) {
        return {
            BAD_REQUEST: 400, SDP_INVALID: 400, CODEC_UNSUPPORTED: 400, STREAM_NAME_INVALID: 400,
            FORBIDDEN: 401, PROJECT_DENIED: 401, NOT_FOUND: 404, MEDIA_NOT_FOUND: 404,
            METHOD_NOT_ALLOWED: 405, STREAM_NAME_TAKEN: 409,
        }[name] ?? 503;
    }

    #reply(res, status, headerMap = {}, body = '') {
        if (res.headersSent) {
            return;
        }
        const extra = status === 401 ? {'WWW-Authenticate': 'Bearer realm="xiomb"'} : {};
        res.writeHead(status, {...HEADER_MAP, ...extra, ...headerMap});
        res.end(body);
    }
}
