import {EventEmitter} from "node:events";

export default class ObjectExtend extends EventEmitter {


    _destroyMessage = null;

    #timeInitObject = Date.now();
    #timeCreateObject = null;
    #timeDestroyObject = null;

    getTimeInitObject(){
        return this.#timeInitObject;
    }

    getTimeCreateObject(){
        return this.#timeCreateObject;
    }

    getTimeDestroyObject(){
        return this.#timeDestroyObject;
    }

    isCreateObject(){
        return !!this.#timeCreateObject;
    }

    isDestroyObject(){
        return !!this.#timeDestroyObject;
    }

    async create() {
        if(this.isCreateObject()){
            throw new Error(`Object is already created.`);
        }
        this.#timeCreateObject = Date.now();
        this.emit("create", this);
        return this;
    }

    async destroy(destroyMessage) {
        if(this.isDestroyObject()) {
            throw new Error(`Object destroyed`);
        }
        if(typeof destroyMessage !== "string" ){
            throw new Error(`destroyMessage is not a string`);
        }
        this.#timeDestroyObject = Date.now();
        this._destroyMessage = destroyMessage;
        this.emit("destroy", this);
        this.removeAllListeners();
        return this;
    }
}