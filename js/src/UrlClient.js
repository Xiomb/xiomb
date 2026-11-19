import {randomUUID} from "node:crypto";

/**
 * Подключение по ссылке (HLS, RTSP, RTMP) для хука auth: параметры адреса вместо query сокета
 */
export class UrlSocket {
    #paramMap;
    #ip;
    #userAgent;

    /**
     * @param paramMap параметры из адреса; auth_login и auth_password — логин и пароль
     * @param ip
     */
    constructor(paramMap, ip, userAgent = '') {
        this.#paramMap = {...paramMap};
        this.#ip = ip;
        this.#userAgent = userAgent;
    }

    getQueryVal(name) {
        return this.#paramMap[name];
    }

    getQuery() {
        return {...this.#paramMap};
    }

    getIP() {
        return this.#ip;
    }

    getOrigin() {
        return '';
    }

    // как у сокета браузера: getReqHeaders()['user-agent']
    getReqHeaders() {
        return this.#userAgent ? {'user-agent': this.#userAgent} : {};
    }

    // User-Agent (HLS, RTSP) или flashVer (RTMP)
    getUserAgent() {
        return this.#userAgent;
    }
}

/**
 * Подключение по ссылке для хуков publish и play: пользователь из хука auth
 */
export class UrlClient {
    #ID = randomUUID();
    #user;
    #socket;
    #transport;

    /**
     * @param user результат хука auth
     * @param socket UrlSocket
     * @param transport hls | rtsp | rtmp
     */
    constructor(user, socket, transport) {
        this.#user = user;
        this.#socket = socket;
        this.#transport = transport;
    }

    getID() {
        return this.#ID;
    }

    getUser() {
        return this.#user;
    }

    getUserID() {
        return String(this.#user?.ID ?? '');
    }

    getIP() {
        return this.#socket.getIP();
    }

    getSocket() {
        return this.#socket;
    }

    getUserAgent() {
        return this.#socket.getUserAgent();
    }

    getTransport() {
        return this.#transport;
    }

    getMediaObjectList() {
        return [];
    }
}
