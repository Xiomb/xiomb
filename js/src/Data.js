export const MAX_DATA = 4096;

export function encodeData(value) {
    if (value === undefined || value === null) {
        return '';
    }
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > MAX_DATA) {
        throw new Error(`Data over ${MAX_DATA} bytes`);
    }
    return text;
}

export function decodeData(text) {
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}
