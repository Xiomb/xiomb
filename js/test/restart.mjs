import assert from "node:assert/strict";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let n = 0;
const ok = name => console.log(`ok ${++n} - ${name}`);

class FakePeerConnection {
    localDescription = null;
    remoteDescription = null;
    getTransceivers() { return []; }
    addTransceiver() {}
    addTrack() {}
    createOffer() { return Promise.resolve({type: 'offer', sdp: 'v=0'}); }
    setLocalDescription(description) { this.localDescription = description; return Promise.resolve(); }
    close() { this.closed = true; }
}
class FakeMediaStream {
    constructor(trackList = []) { this.trackList = trackList; }
    getTracks() { return this.trackList; }
}
globalThis.RTCPeerConnection = FakePeerConnection;
globalThis.MediaStream = FakeMediaStream;
globalThis.window = {};

const {xiombSession} = await import('../sdk/src/xiombSession.js');
const {xiombHlsSession} = await import('../sdk/src/xiombHlsSession.js');

class FakeSDK {
    requestList = [];
    sessionMap = new Map();
    failNext = null;
    seq = 0;
    getParams() { return {}; }
    async getIceServers() { return {iceServerList: [], turn: ''}; }
    notify() {}
    request(type, data) {
        this.requestList.push({type, data});
        if (this.failNext) {
            const error = Object.assign(new Error(this.failNext), {name: this.failNext});
            this.failNext = null;
            return Promise.reject(error);
        }
        if (type === 'media.close') {
            return Promise.resolve({});
        }
        return Promise.resolve({ID: `m${++this.seq}`, name: data.name, status: 'connect', playURL: 'https://node/hls/x.m3u8'});
    }
    addMediaSession(session) { this.sessionMap.set(session.getID(), session); }
    getHlsEntry() { return null; }
    getQuery() { return {}; }
    deleteMediaSession(session) { this.sessionMap.delete(session.getID()); }
}

function record(session) {
    const eventList = [];
    for (const name of ['status', 'restarted', 'closed']) {
        session.on(name, data => eventList.push({name, data}));
    }
    return eventList;
}

const sdk = new FakeSDK();
const publish = new xiombSession(sdk, 'publish', 'cam', {mediaStream: new FakeMediaStream(), restartTimeout: 5000});
const publishEventList = record(publish);
await publish.start();
assert.equal(publish.getID(), 'm1');

publish.onClosed({reason: {name: 'MEDIA_TERMINATED', message: 'Media terminated'}});
assert.equal(publish.getStatus(), 'reconnect');
assert.equal(publish.isClosed(), false);
assert.equal(sdk.sessionMap.size, 0);
ok('MEDIA_TERMINATED -> publish goes to reconnect instead of closing');

await sleep(1200);
assert.equal(publish.getID(), 'm2');
assert.ok(sdk.sessionMap.has('m2'));
assert.deepEqual(publishEventList.find(e => e.name === 'restarted').data, {ID: 'm2'});
ok('publish restarted after 1 s with a new media ID');

publish.onClosed({reason: {name: 'SERVICE_UNAVAILABLE'}});
sdk.failNext = 'NOT_CONNECTED';
await sleep(1200);
assert.equal(publish.getID(), null);
await sleep(2200);
assert.equal(publish.getID(), 'm3');
ok('restart failing with NOT_CONNECTED is retried with a longer delay');

publish.onClosed({reason: {name: 'STREAM_ENDED'}});
assert.equal(publish.isClosed(), true);
assert.equal(publishEventList.at(-1).name, 'closed');
ok('STREAM_ENDED closes a publish for good');

const play = new xiombSession(sdk, 'play', 'cam', {});
await play.start();
play.onClosed({reason: {name: 'STREAM_ENDED'}});
assert.equal(play.getStatus(), 'reconnect');
await play.close();
await sleep(1200);
assert.equal(play.isClosed(), true);
assert.equal(play.getID(), null);
ok('STREAM_ENDED -> play waits for the stream; close() during the wait stops the restart');

const noRestart = new xiombSession(sdk, 'play', 'cam', {autoRestart: false});
await noRestart.start();
noRestart.onClosed({reason: {name: 'MEDIA_TERMINATED'}});
assert.equal(noRestart.isClosed(), true);
ok('autoRestart: false keeps the old behaviour');

const shortTimeout = new xiombSession(sdk, 'play', 'cam', {restartTimeout: 500});
const shortEventList = record(shortTimeout);
await shortTimeout.start();
shortTimeout.onClosed({reason: {name: 'MEDIA_TERMINATED'}});
sdk.failNext = 'NOT_CONNECTED';
await sleep(1200);
assert.equal(shortTimeout.isClosed(), true);
assert.equal(shortEventList.at(-1).data.name, 'NOT_CONNECTED');
ok('gives up after restartTimeout');

const resumed = new xiombSession(sdk, 'play', 'cam', {});
await resumed.start();
resumed.onClosed({reason: {name: 'MEDIA_NOT_FOUND', message: 'Media not found'}});
assert.equal(resumed.getStatus(), 'reconnect');
await sleep(1200);
assert.ok(resumed.getID());
ok('MEDIA_NOT_FOUND after media.resume (project server restarted) -> restart');

const hls = new xiombHlsSession(sdk, 'cam', {});
await hls.start();
const hlsID = hls.getID();
hls.onClosed({reason: {name: 'MEDIA_TERMINATED'}});
await sleep(1200);
assert.notEqual(hls.getID(), hlsID);
assert.equal(hls.getPlayURL(), 'https://node/hls/x.m3u8');
ok('HLS play restarts the same way');

const moving = new xiombSession(sdk, 'play', 'cam', {});
const movingStreamList = [];
moving.on('stream', stream => movingStreamList.push(stream));
await moving.start();
const oldPeerConnection = moving.getPeerConnection();
oldPeerConnection.connectionState = 'connected';
oldPeerConnection.ontrack({track: {kind: 'video', stop() {}}});
moving.onStatus({status: 'reconnect', renegotiate: true});
await sleep(20);
const newPeerConnection = moving.getPeerConnection();
assert.notEqual(newPeerConnection, oldPeerConnection);
assert.ok(!oldPeerConnection.closed);
const newTrack = {kind: 'video', stop() {}};
newPeerConnection.ontrack({track: newTrack});
assert.equal(movingStreamList.length, 1);
newPeerConnection.connectionState = 'connected';
newPeerConnection.onconnectionstatechange();
assert.ok(oldPeerConnection.closed);
assert.deepEqual(movingStreamList.at(-1).getTracks(), [newTrack]);
ok('renegotiate: the old connection plays until the new one connects, then the tracks switch');

sdk.failNext = 'NODE_UNAVAILABLE';
moving.onStatus({status: 'reconnect', renegotiate: true});
await sleep(20);
assert.equal(moving.getPeerConnection(), newPeerConnection);
assert.ok(!newPeerConnection.closed);
moving.onStatus({status: 'play', renegotiate: false});
await moving.close();
ok('renegotiate failed: the old connection stays');

console.log('ALL PASSED');
process.exit(0);
