import xSocket from "xsocket";
import ObjectExtend from "./ObjectExtend.js";
import {ProjectError} from "./ProjectError.js";
import {Client} from "./Client.js";

export class Clients extends ObjectExtend {
    #project;
    #server = null;
    #userObjectMap = new WeakMap();
    #clientObjectMap = new Map();

    constructor(project) {
        super();
        this.#project = project;
    }

    async start() {
        const settings = this.#project.getSettings().socket;
        this.#server = new xSocket.Server({
            port: settings.port,
            host: settings.host,
            https: {...settings.https},
            socketObjectTimeout: settings.socketObjectTimeout,
            auth: true,
        });
        this.#server.use('auth', (socket, success, failed) => {
            this.#authenticate(socket).then(() => success(), e => failed(ProjectError.from(e).toPublic().name));
        });
        this.#server.on('connect', socket => this.#connect(socket));
        // OBS по WHIP на том же порту
        this.#server.on('https', (req, res) => this.#project.getWhipApp().handle(req, res));
        this.#server.on('error', e => this.#project.log('error', `socket: ${e.message}`));
        await this.#server.listen();
        this.#project.log('system', `socket: listening on ${settings.port}`);
        return this;
    }

    async destroy(destroyMessage) {
        for (const client of this.getClientList()) {
            client.disconnect('shutdown');
        }
        await this.#server?.close();
        this.#server = null;
        return super.destroy(destroyMessage);
    }

    getClient(ID) {
        return this.#clientObjectMap.get(ID) ?? null;
    }

    getClientList() {
        return [...this.#clientObjectMap.values()];
    }

    async #authenticate(socket) {
        const originList = this.#project.getSettings().socket.originList;
        if (originList.length && !originList.includes(socket.getOrigin())) {
            this.#project.log('warning', `socket: origin ${socket.getOrigin()} from ${socket.getIP()} rejected`);
            throw new ProjectError('FORBIDDEN');
        }
        let user;
        try {
            user = await this.#project.callHook('auth', socket);
        } catch (e) {
            this.#project.log('warning', `socket: auth denied for ${socket.getIP()} (origin ${socket.getOrigin()}): ${ProjectError.from(e).name}`);
            throw e;
        }
        this.#userObjectMap.set(socket, user);
    }

    #connect(socket) {
        const client = new Client(this.#project, socket, this.#userObjectMap.get(socket));
        this.#userObjectMap.delete(socket);
        this.#clientObjectMap.set(client.getID(), client);
        socket.on('data', xSocketData => client.dispatch(xSocketData));
        socket.once('destroy', () => client.destroy('socket destroyed').catch(() => {}));
        client.once('destroy', () => {
            this.#clientObjectMap.delete(client.getID());
            this.#project.emit('client|destroy', client);
        });
        this.#project.emit('client', client);
        client.sendSessionReady();
    }
}
