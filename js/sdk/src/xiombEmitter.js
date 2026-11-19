export class xiombEmitter {
    #listenerMap = {};

    #add(name, callback, once) {
        if (typeof name !== 'string' || typeof callback !== 'function') {
            return this;
        }
        if (!this.#listenerMap.hasOwnProperty(name)) {
            this.#listenerMap[name] = [];
        }
        this.#listenerMap[name].push({callback, once});
        return this;
    }

    on(name, callback) {
        return this.#add(name, callback, false);
    }

    once(name, callback) {
        return this.#add(name, callback, true);
    }

    off(name, callback) {
        if (!this.#listenerMap.hasOwnProperty(name)) {
            return this;
        }
        const listenerList = this.#listenerMap[name].filter(listener => listener.callback !== callback);
        if (listenerList.length) {
            this.#listenerMap[name] = listenerList;
        } else {
            delete this.#listenerMap[name];
        }
        return this;
    }

    emit(name, ...args) {
        if (!this.#listenerMap.hasOwnProperty(name)) {
            return this;
        }
        for (const listener of this.#listenerMap[name].slice()) {
            if (listener.once) {
                this.off(name, listener.callback);
            }
            try {
                listener.callback.apply(this, args);
            } catch (e) {
                console.error('[xiomb]', e);
            }
        }
        return this;
    }
}
