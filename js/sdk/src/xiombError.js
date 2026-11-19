export class xiombError extends Error {
    constructor(name, message, cause) {
        const errorName = name || 'INTERNAL';
        super(message || errorName);
        this.name = errorName;
        this.cause = cause || null;
    }
}
