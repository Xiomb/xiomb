# xiomb

Server and browser SDK for [xiomb](https://xiomb.com), a cloud audio/video streaming server with WebRTC, HLS, RTSP, RTSPS, RTMP and RTMPS.

- **Live in the browser**: publish a camera and microphone over WebRTC, watch over WebRTC (sub-second latency) or HLS.
- **Any source**: IP cameras and encoders publish over RTSP, RTSPS, RTMP or RTMPS (OBS, ffmpeg); the cloud can also pull an RTSP/HTTP source by itself.
- **Recording and snapshots**: record a live stream to a file and take JPEG snapshots on demand.
- **Your rules**: every connection, publish and play goes through hooks in your own server, so access control stays in your code.
- **Survives failures**: the SDK reconnects, resumes sessions and restarts streams by itself; the server follows the project when it moves to another region.

## Contents

- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Server](#server)
  - [Settings](#settings)
  - [Hooks](#hooks)
  - [Custom requests and notifications](#custom-requests-and-notifications)
  - [Methods](#server-methods)
  - [Events](#server-events)
  - [Client](#client)
  - [MediaObject](#mediaobject)
  - [Stream info](#stream-info)
- [Links: HLS, RTSP, RTSPS, RTMP, RTMPS](#links-hls-rtsp-rtsps-rtmp-rtmps)
- [OBS over WebRTC (WHIP)](#obs-over-webrtc-whip)
- [Browser SDK](#browser-sdk)
  - [Install](#install)
  - [xiomb](#xiomb-1)
  - [Publish and play: xiombObject](#publish-and-play-xiombobject)
  - [Player: xiombPlayer](#player-xiombplayer)
  - [Statistics](#statistics)
  - [Reconnect and restart](#reconnect-and-restart)
- [Errors](#errors)
- [Browser support](#browser-support)
- [Demo](#demo)
- [License](#license)

## How it works

```
 Browser (SDK)  ── WebSocket ──>  Your project server (this package)  ── gRPC ──>  xiomb cloud
       │                                    │                                        │
       └──────────── WebRTC / HLS media ────┼────────────────────────────────────────┘
 Cameras, OBS ────── RTSP(S) / RTMP(S) ─────┴──── hook "rtsp" asks your server ──────┘
```

1. You create a project at [xiomb.com/projects](https://xiomb.com/projects) and get a **project ID** and a **secret key**.
2. You run the **project server** from this package next to your application. It connects to the xiomb cloud with the project ID and secret, and opens a WebSocket for your users.
3. Your web page uses the **browser SDK**. It connects to your project server, not to the cloud, so the server decides who may connect, publish and play.
4. Media goes directly between the browser and the cloud; your server only handles signalling and decisions.

The secret never leaves your server. The browser only knows the address of your project server and whatever token your application gives it.

## Quick start

### 1. Create a project

Open [xiomb.com/projects](https://xiomb.com/projects), create a project and copy its ID. Open the project, press **New key** and copy the secret: it is shown only once. You can keep several keys and revoke any of them. In **Allowed IPs** you can restrict which server addresses may connect with these keys.

### 2. Install

```bash
npm install xiomb
```

Node.js 18 or newer.

### 3. Run the project server

```js
import {XiombProject, ProjectError} from 'xiomb';

const project = new XiombProject({
    core: {
        portalURL: 'https://xiomb.com',
        projectID: process.env.XIOMB_PROJECT_ID,
        secret: process.env.XIOMB_SECRET,
    },
    socket: {
        port: 8443,
        https: {cert: '/etc/ssl/example.com/fullchain.pem', key: '/etc/ssl/example.com/privkey.pem'},
        originList: ['https://example.com'],
    },
});

// who is connecting: the browser passes a token in the query
project.use('auth', async socket => {
    const user = await findUserByToken(socket.getQueryVal('token'));
    return user ? {ID: String(user.id), data: {name: user.name}} : false;
});

// a user may publish only to a stream named after them
project.use('publish', (client, {name}) => name === `user/${client.getUserID()}`);

// anyone authenticated may watch
project.use('play', () => true);

await project.start();
```

### 4. Publish and watch in the browser

```html
<link rel="stylesheet" href="https://unpkg.com/xiomb/sdk/xiombPlayer.min.css">
<div id="publisher" style="width: 640px; height: 360px"></div>
<div id="viewer" style="width: 640px; height: 360px"></div>

<script type="module">
    import {xiomb} from 'https://unpkg.com/xiomb/sdk/xiomb.min.mjs';

    const client = new xiomb({url: 'wss://example.com:8443', query: {token: USER_TOKEN}});

    // camera preview with a "Go live" button
    client.publish('user-42', {targetEl: document.getElementById('publisher'), title: 'My camera'});

    // plays once the stream is live; until then the player shows "Stream not found" and a Play button
    client.play('user-42', {targetEl: document.getElementById('viewer')});
</script>
```

That is a complete integration: the player draws its own controls (start/stop, mute, camera off, device selection, fullscreen), asks for camera access and shows errors.

## Server

```js
import {XiombProject, ProjectError} from 'xiomb';
```

### Settings

`new XiombProject(settings)`:

| Setting | Default | Description |
|---|---|---|
| `core.projectID` | — | Project ID from [xiomb.com/projects](https://xiomb.com/projects). Required. |
| `core.secret` | — | Project key. Required. |
| `core.portalURL` | — | `https://xiomb.com`. The server asks the portal which cloud region serves the project and follows it when the project moves. |
| `core.address` | `eu-test.xiomb.com:443` | Fixed cloud address `host:port` instead of `portalURL`, for self-hosted setups. Used when neither `portalURL` nor `address` is set. |
| `core.tls` | `true` with the default address, otherwise `false` | `true` for TLS to the cloud, or `{ca: Buffer}` with a custom CA certificate. |
| `core.failoverTimeout` | `20000` | While the cloud is unreachable for less than this (ms), reconnect to the same region; after it, ask the portal again. |
| `core.requestTimeout` | `15000` | Timeout of a single request to the cloud, ms. |
| `core.reconnectMax` | `10000` | Maximum delay between reconnect attempts, ms. |
| `core.giveUpAfter` | `0` | After this many failed attempts emit `core|lost`. `0` never gives up. |
| `core.closeClientsOnLost` | `true` | On `core|lost` tell the browsers (`lost` event in the SDK) and disconnect them. |
| `socket.port` | — | Port of the WebSocket for browsers. Required. |
| `socket.host` | all interfaces | Address to listen on, e.g. `127.0.0.1`. |
| `socket.https` | `{}` | `{cert, key}` paths to the certificate. With them the socket is `wss://`, without — `ws://` (use only behind a TLS proxy). |
| `socket.originList` | `[]` | Allowed `Origin` values of browser pages. Empty allows any. |
| `socket.socketObjectTimeout` | `10000` | How long a browser may be away and come back to the same session, ms. |
| `hookTimeout` | `10000` | Timeout of a hook or a request handler, ms. |
| `resumeTimeout` | `30000` | After a restart of your server, how long browser media wait for their browsers to resume them, ms. `0` closes them at once. |
| `logger` | — | `(level, message) => {}`. Levels: `system`, `debug`, `warning`, `error`. Without it warnings and errors go to `console.error`. |

### Hooks

`project.use(name, fn)` sets a hook. Without a hook the action is denied (`FORBIDDEN`). A hook may be `async`.

A hook **denies** by returning `false`, `null` or `undefined`, or by throwing. Throw a `ProjectError` to send your own error to the browser: `throw new ProjectError('PAYMENT_REQUIRED', 'Top up your balance')`. Any other exception becomes `FORBIDDEN`, and the details stay in your log.

#### `auth(socket)`

Called for every WebSocket connection before it is accepted.

```js
project.use('auth', async socket => {
    const session = await sessionStore.get(socket.getQueryVal('token'));
    if (!session) {
        return false;
    }
    return {ID: String(session.userID), data: {name: session.userName}};
});
```

`socket` is the xSocket connection: `getQueryVal(name)`, `getQuery()`, `getIP()`, `getOrigin()`. Return any object: it becomes `client.getUser()`. Its `ID` becomes the user ID of the client's media, its `data` the default media data (see below).

#### `publish(client, {name, custom})`

The browser wants to publish stream `name`.

#### `play(client, {name, transport, custom})`

The browser wants to watch stream `name`; `transport` is `webrtc` or `hls`.

For both hooks:

- `true` — allow as is;
- a string — allow under another stream name (`return 'room-' + roomID`);
- `{name, data}` — allow, optionally change the name and attach `data`;
- `custom` is the object the page passed in the `custom` option (up to 8 KB of JSON) — use it for room IDs, invite codes, etc.

`data` is any JSON value up to 4 KB. It is stored with the media and comes back in `mediaObject.getData()`, in [stream info](#stream-info) and in the viewer list, so you can tell who is behind each stream without your own lookup table.

Stream names: 1–50 characters `A–Z a–z 0–9 _ -`; anything else is refused with `STREAM_NAME_INVALID`. A name is unique within the project while it is being published.

```js
project.use('publish', async (client, {name, custom}) => {
    const room = await rooms.find(custom.roomID);
    if (!room?.hasMember(client.getUserID())) {
        throw new ProjectError('NOT_A_MEMBER', 'You are not in this room');
    }
    return {name: `room/${room.id}/${client.getUserID()}`, data: {room: room.id}};
});
```

#### Connections by link: the same `auth`, `publish`, `play`

An HLS, RTSP or RTMP client (camera, OBS, ffmpeg, a media player, a TV) goes through the same hooks as the browser (see [Links](#links-hls-rtsp-rtsps-rtmp-rtmps)):

- `auth(socket)` — `socket` holds the link parameters instead of the socket query: `socket.getQueryVal('auth_login')`, `getQuery()`, `getIP()`, `getUserAgent()` (`User-Agent` of the player, `flashVer` of an RTMP client; for the browser socket read `socket.getReqHeaders()['user-agent']`, which works for links too); login and password from the link are `auth_login` and `auth_password`. The returned `ID` becomes the user ID of the media, `data` its default data, e.g. `{ID, data: {ip: socket.getIP(), device: socket.getReqHeaders()['user-agent']}}`.
- `publish(client, {name, transport})` / `play(client, {name, transport})` — `client.getUser()`, `getUserID()`, `getIP()`, `getTransport()` (`hls`, `rtsp`, `rtmp`). The stream name is fixed by the link: a hook that returns another name refuses.

So one `auth` handles the browser and every player; a refusal is `401` for HLS and RTSP, the player asks for the password.

#### `rtsp({userID, token, name, direction, transport, remoteAddress, params})`

Optional, for compatibility: when this hook is set, links go through it instead of `auth` + `publish`/`play`. `userID` and `token` are the login and password, `params` the link parameters. Return truthy to allow, `{data}` to attach data.

```js
project.use('rtsp', async ({userID, token, name, direction}) => {
    const camera = await cameras.findByToken(token);
    return camera && camera.streamName === name && direction === 'publish' ? {data: {cameraID: camera.id}} : false;
});
```

#### `resume(client, {ID, name, direction, userID, data})`

After **your server** restarts, browsers reconnect and ask to take their media back. Allow it if the media belongs to the user:

```js
project.use('resume', (client, {userID}) => userID === client.getUserID());
```

Without this hook media that were live during your server's restart are closed with `FORBIDDEN`. If you would rather have the SDK restart them from scratch, set `resumeTimeout: 0`.

### Custom requests and notifications

The SDK socket can carry your own messages, so you do not need a second connection for chat, room state, etc.

Browser → server, with a response:

```js
// server
project.handle('chat.send', async (client, {text}) => {
    await chat.save(client.getUserID(), text);
    project.notifyAll('chat.message', {from: client.getUser().data.name, text});
    return {ok: true};
});
project.handle('room.*', (client, data, type) => rooms.dispatch(type, client, data));

// browser
await client.request('chat.send', {text: 'Hello'});
```

A handler receives `(client, data, type)`; its return value is the response. Throw a `ProjectError` to reject with your own error. Names starting with `media.` and `session.` are reserved. A name ending with `*` matches a prefix.

Server → browser:

```js
client.notify('balance', {credits: 120});         // one client
project.notifyAll('maintenance', {at: '22:00'});  // everyone

// browser
client.on('message', (event, data) => console.log(event, data));
```

### Server methods

| Method | Description |
|---|---|
| `start()` | Connect to the cloud and open the socket. Resolves when ready; rejects on a wrong project ID or secret. |
| `stop(reason?)` | Disconnect browsers and the cloud, free the port. |
| `use(name, fn)` | Set a [hook](#hooks). |
| `handle(type, fn)` | Set a [request handler](#custom-requests-and-notifications). |
| `notifyAll(event, data?)` | Send a notification to every connected browser. |
| `getClient(ID)` / `getClientList()` | Connected [clients](#client). |
| `getMediaObject(ID)` / `getMediaObjectList()` | All media of the project: browser, RTSP/RTMP, pulled and pushed. See [MediaObject](#mediaobject). |
| `closeMedia(ID, reason?)` | Close a media. `reason` — a `ProjectError` or a string; the browser receives it. |
| `listStreams()` | `Promise<StreamInfo[]>` — streams being published now, with tracks, viewers, recordings. See [stream info](#stream-info). |
| `killStream(name, reason?)` | Stop a published stream and all its viewers. |
| `getHlsURL(name, options?)`, `getRtspURL`, `getRtspsURL`, `getRtmpURL`, `getRtmpsURL` | `string` — a link for a player, camera or OBS: `<cloud entry>/<projectID>/<name>?auth_login=…&auth_password=…&…`. `options`: `{login, password, ...params}`; `login` and `password` become `auth_login` and `auth_password`, the other fields go to the `auth` hook as link parameters. The entries come from the cloud on connect; throws `SERVICE_UNAVAILABLE` before that and `LINK_NOT_SET` if the cloud has no such entry. See [Links](#links-hls-rtsp-rtsps-rtmp-rtmps). |
| `getTransportURL(transport, name, options?)` | The same with `transport`: `hls`, `rtsp`, `rtsps`, `rtmp` or `rtmps`. |
| `snapshot(name)` | `Promise<string>` — take a JPEG of a live stream, resolves with its URL. |
| `setRecording(name, enabled)` | Start or stop recording a live stream. File URLs appear in `recordingUrls` of the stream info. |
| `pull(name, uri, {rtspTransport?, loop?, data?})` | Make the cloud pull an external source and publish it as `name`: a camera or server over `rtsp(s)://` or `rtmp(s)://` (`login:password@` in the address for RTSP and RTMP authorization, HTTP Basic for `http(s)://`; a wrong password closes the pull with `PULL_FAILED`), a live HLS stream over `http(s)://…/*.m3u8` (Twitch, YouTube Live, a CDN; the best H264 variant is taken, the pull closes when the stream ends, and with `PULL_FAILED` when its address is not allowed or the playlist is encrypted), or a media file over `http(s)://` or `ftp(s)://`. `rtspTransport`: `auto`, `tcp` or `udp` (RTSP only); `loop` repeats a file. Resolves with a [MediaObject](#mediaobject). |
| `push(name, uri, {video?, audio?, data?})` | Restream the live stream `name` to an `rtmp://` or `rtmps://` server (YouTube, Twitch), the stream key in the path; `rtmp://login:password@host/…` for servers with RTMP authorization (Wowza, Nimble). `video`: `{codec, bitrate, keyframeInterval, disabled}` — `codec` `auto` (default), `copy` or `H264`, `bitrate` in kbit/s (100–50000), `keyframeInterval` in ms (500–10000); `audio`: `{codec, bitrate, disabled}` — `codec` `auto`, `copy` or `AAC`, `bitrate` in kbit/s (32–512). `copy` takes no bitrate. Resolves with a [MediaObject](#mediaobject) with direction and transport `push`: status `push` once the server accepted the stream, `reconnect` while it retries; closes with `PUSH_FAILED` or when the stream ends. A push is not a viewer: it is not counted in `viewers` and not listed in `viewerList`. |
| `getSettings()` | Normalized settings. |

```js
const streamList = await project.listStreams();
const url = await project.snapshot('lobby-cam1');
await project.setRecording('lecture-42', true);
await project.pull('lobby-cam1', 'rtsp://10.0.0.15/stream1', {rtspTransport: 'tcp'});
await project.push('lecture-42', 'rtmps://a.rtmps.youtube.com/live2/STREAM-KEY', {video: {bitrate: 4500, keyframeInterval: 2000}});
await project.killStream('user-42', 'Terms violated');
```

### Server events

`XiombProject` is an `EventEmitter`.

| Event | Arguments | When |
|---|---|---|
| `ready` | `project` | `start()` finished. |
| `client` | `client` | A browser connected and passed `auth`. |
| `client\|destroy` | `client` | A browser disconnected. |
| `media` | `mediaObject` | A media appeared: a browser started to publish or play, an RTSP/RTMP client connected, a pull or push started. |
| `media\|destroy` | `mediaObject, reason` | A media closed. `reason` is `{name, message}` or `null` for a normal close. |
| `stream\|started` | `streamInfo` | A stream went live (first media arrived). |
| `stream\|ended` | `{name, reason}` | A stream stopped. |
| `core\|disconnect` | `{name, message}` | Connection to the cloud lost. Live media keep going, the server reconnects by itself. |
| `core\|reconnect` | `{attempts}` | Connection to the cloud restored. |
| `core\|retry` | `{attempt, delay}` | A reconnect attempt failed. |
| `core\|lost` | `{attempts}` | `giveUpAfter` attempts failed. |
| `log` | `level, message` | Every log line. |

```js
project.on('stream|started', stream => console.log('live:', stream.name, stream.userID, stream.data));
project.on('media|destroy', (mediaObject, reason) => billing.stop(mediaObject.getID(), reason));
```

### Client

A connected browser, `project.getClient(ID)`, argument of hooks and handlers.

| Method | Returns |
|---|---|
| `getID()` | Connection ID (also the `getSessionID()` of the SDK). |
| `getUser()` / `getUserID()` | What `auth` returned / its `ID` as a string. |
| `getIP()` / `getOrigin()` / `getQuery()` | Address, page origin and query of the connection. |
| `getMediaObjectList()` / `getMediaObject(ID)` | Media of this client. |
| `notify(event, data?)` | Send a notification to this browser. |
| `disconnect(reason?)` | Close the connection and its media. |

### MediaObject

A media of the project: a browser publish or play, an RTSP/RTMP client, a pull, a push.

| Method | Returns |
|---|---|
| `getID()` | Media ID. |
| `getName()` | Stream name. |
| `getDirection()` | `publish`, `play` or `push` (restream to an RTMP server). |
| `getTransport()` | `webrtc`, `hls`, `rtsp`, `rtmp`, `pull`, `push`. |
| `getStatus()` | `connect`, `publish`, `play`, `push` (restream is live), `reconnect`, `stop`. |
| `getUserID()` / `getData()` | User and data set by the hooks. |
| `getClientAddress()` / `getUserAgent()` | Address and program of the client (browser, player, encoder): `User-Agent`, or `flashVer` for RTMP; empty when unknown. |
| `getClient()` | The browser [client](#client), or `null` for RTSP/RTMP/pull/push. |
| `getPlayURL()` | HLS playlist URL for an HLS viewer. |
| `getSnapshotURL()` | URL of the last snapshot of a publish, empty until the first one. |
| `getInfo()` | `{ID, name, direction, transport, playURL, status, renegotiate}`. |
| `getStat()` | `Promise` — fresh statistics from the cloud. |
| `getLastStat()` | Last statistics: `{ID, measuredAt, trackList, transcoderList, recording, viewers}`. |
| `getVideoWidth()`, `getVideoHeight()`, `getFPS()`, `getVideoCodec()`, `getAudioCodec()`, `getVideoBitrate()`, `getAudioBitrate()`, `getBitrate()`, `getPacketsLost()`, `getDropped()`, `isLive()`, `isRecording()`, `getViewerCount()`, `getTranscoderList()` | Shortcuts over the last statistics; `null` until the first one. |

Events: `status` (`mediaObject`) on status change, `stat` (`stat`) on new statistics, `snapshot` (`url`) on a new snapshot of a publish.

### Stream info

`listStreams()` and `stream|started` give:

```js
{
    ID: 'b0c1…',                 // media ID of the publisher
    name: 'user-42',
    transport: 'webrtc',         // webrtc | rtsp | rtmp | pull
    userID: '42',
    data: {name: 'Alice'},       // from the publish hook
    createdAt: 1767225600000,
    tracks: [{kind: 'video', codec: 'H264', width: 1280, height: 720, fps: 30, bitrate: 2400000, live: true}],
    recording: false,
    recordingUrls: [],           // finished and current recording files
    snapshotUrl: '',             // last snapshot
    viewers: 3,
    viewerList: [{ID, userID, data, transport, status, createdAt}],
}
```

Viewers in another codec than the source get it transcoded by the cloud automatically.

## Links: HLS, RTSP, RTSPS, RTMP, RTMPS

Players, cameras and encoders connect by a link; every link goes through your `auth` hook and then `publish` or `play`, the same as the browser.

```
https://<login>:<password>@<hls-host>/<projectID>/<stream>
https://<hls-host>/<projectID>/<stream>?auth_login=<login>&auth_password=<password>&<any>=<value>
rtsp://<login>:<password>@<rtsp-host>/<projectID>/<stream>?<any>=<value>
rtsps://<rtsps-host>:322/<projectID>/<stream>?auth_login=<login>&auth_password=<password>
rtmp://<rtmp-host>/<projectID>/<stream>?auth_login=<login>&auth_password=<password>&<any>=<value>
rtmps://<rtmp-host>:1936/<projectID>/<stream>?auth_login=<login>&auth_password=<password>
```

Build them with `project.getRtmpsURL(name, {login, password})` and the other link methods: the hosts are the public entries of the cloud, sent to the project on connect.

| Link | Entry | Publish | Play |
|---|---|---|---|
| HLS | HLS entry of the cloud, `302` to a node | — | yes |
| RTSP, RTSPS | entry of the nodes (or the RTSP entry of the cloud, `302` to a node: play only) | yes | yes |
| RTMP, RTMPS | entry of the nodes | yes | yes |

- `login:password@` and `auth_login`/`auth_password` are the same thing; the hook sees `auth_login` and `auth_password`. For RTMP the older `?user=&token=` still works.
- Any other parameters are passed to `auth` as they are, filtered: name `A–Z a–z 0–9 _` up to 32, value up to 512 characters without control characters, at most 16; player service parameters (`_HLS_*`) are dropped.
- HLS is play only. The link stays the same, but every launch is a viewer of its own: the link answers with a short master playlist pointing to this launch's session (`/live/<mediaID>/index.m3u8?token=…`), and the player keeps asking that address. The hooks are asked once per launch; a launch silent for `idle_seconds` ends by itself. Two devices or two launches of the same link are two viewers.
- Browsers do not send `login:password@` from a URL; use the query form or the SDK there.
- `<hls-host>` is the HLS entry of the cloud: it checks that the stream of this project is live (`404` at once if not) and redirects to the node that serves it, carrying the parameters (and `login:password` as `auth_login`/`auth_password`).
- The browser SDK plays HLS the same way: the link to the entry with the parameters of its socket, so `auth` and `play` decide for it as for any player. A viewer by link has no media ID in the browser and ends by itself a few seconds after the player stops.

For OBS: **Server** — the link without the stream name, **Stream key** — the name:

```js
const url = project.getRtmpsURL(name, {login, password: key});
// OBS: Server = rtmps://<entry>:1936/<projectID>?auth_login=…&auth_password=…, Stream key = name
const server = url.replace(`/${name}?`, '?');
```

A stream published by a link can be watched in the browser over WebRTC or HLS, and the other way round.

## OBS over WebRTC (WHIP)

OBS 30+ publishes over WebRTC straight to your project server, on the socket port:

- **Service** `WHIP`, **Server** `https://<project-host>:<socket-port>/whip/<stream>?auth_login=<login>`, **Bearer Token** `<password>`.
- The token becomes `auth_password`; `auth` and `publish` decide as for a link (the old `rtsp` hook too, if it is set). The media has `transport: 'webrtc_obs'`.
- Stream name: `A–Z a–z 0–9 _ -`, up to 50 characters, from the address; the hook cannot rename it.
- OBS stops by `DELETE` on the `Location` it got (`/whip/resource/<mediaID>`). If the node is lost the media closes: OBS reconnects with a new `POST`.
- Video H264, audio Opus. Set B-frames to 0 in the encoder, otherwise WebRTC viewers get it transcoded.

## Browser SDK

### Install

With a bundler:

```js
import {xiomb} from 'xiomb/sdk';
import 'xiomb/sdk/xiombPlayer.css';
```

From a CDN:

```html
<link rel="stylesheet" href="https://unpkg.com/xiomb/sdk/xiombPlayer.min.css">

<!-- modern browsers, ES module -->
<script type="module">
    import {xiomb} from 'https://unpkg.com/xiomb/sdk/xiomb.min.mjs';
</script>

<!-- any browser, global window.xiomb -->
<script src="https://unpkg.com/xiomb/sdk/xiomb.min.js"></script>
```

| File | Format |
|---|---|
| `sdk/xiomb.mjs`, `sdk/xiomb.min.mjs` | ES module, ES2022, for modern browsers and bundlers. |
| `sdk/xiomb.js`, `sdk/xiomb.min.js` | Script with globals (`window.xiomb`, `window.xiombPlayer`, …), ES5 with a Promise polyfill, for old browsers. |
| `sdk/xiombPlayer.css`, `sdk/xiombPlayer.min.css` | Player styles. |

HLS playback uses [hls.js](https://github.com/video-dev/hls.js) when it is on the page (`window.Hls`) or passed in the config; Safari and iOS play HLS natively without it.

### xiomb

The connection to your project server. One per page is enough for any number of streams.

```js
const client = new xiomb({
    url: 'wss://example.com:8443',
    query: {token: USER_TOKEN},
    messageList: {PERMISSION_DENIED: 'Allow camera access in the browser', default: 'Something went wrong'},
});
```

| Option | Description |
|---|---|
| `url` | Your project server, `wss://host:port`. A string, or a list of addresses: one of them is picked at random for each connection. |
| `query` | Sent with the connection, read by the `auth` hook (`socket.getQueryVal`). |
| `iceServerList` | ICE servers for WebRTC. By default, before each connection the SDK asks your server (`media.turn`) for the cloud's STUN and TURN servers with a one-time TURN login; if the cloud has no TURN, it uses `stun:stun.xiomb.com:3478`. A list given here replaces that, and no TURN login is requested. |
| `params` | `{video: true, audio: true}` — set `false` to work without video or audio everywhere. |
| `messageList` | Texts shown in the player for error names (`{NAME: 'text'}`), `default` for the rest. |
| `Hls`, `hlsConfig` | hls.js class and its config, if not on `window`. |

The connection opens on the first `publish()`/`play()` or on `connect()`.

**Methods**

| Method | Description |
|---|---|
| `publish(name, options?)` | Create a [publisher](#publish-and-play-xiombobject). |
| `play(name, options?)` | Create a [viewer](#publish-and-play-xiombobject). |
| `connect()` | `Promise` — connect now. Rejects with `NOT_CONNECTED` or the `auth` error. |
| `isConnected()` | Connected and the session is ready. |
| `getSessionID()` | Session ID, equal to `client.getID()` on the server. |
| `request(type, data?)` | `Promise` — call a [server handler](#custom-requests-and-notifications). |
| `notify(type, data?)` | Send a message to a server handler without waiting for an answer. |
| `getTransportList()` | Playback transports this browser supports: `['webrtc', 'hls']`. |
| `isTransportSupported(transport)` | `true`/`false`. |
| `getCodecList(isPublish)` | `{video: ['VP8', 'H264', …], audio: ['opus', …]}` the browser can send or receive. |
| `createPlayer(isPublish, targetEl?, options?)` | A standalone [player](#player-xiombplayer). |
| `getMediaSessionList()` | Low-level media sessions of the connection. |
| `setMessageList(messageList)` / `getMessage(error)` | Error texts. |

**Events** — `client.on(name, callback)`, `once`, `off`:

| Event | Arguments | When |
|---|---|---|
| `connect` | — | First connection established. |
| `connectFail` | `error` | First connection failed (wrong URL, `auth` denied). |
| `disconnect` | `reason` | Connection lost; streams show `reconnect` and wait. |
| `reconnect` | — | Connection restored. |
| `resume` | `{resumed, closed}` | After your server restarted: how many media were taken back and how many closed. |
| `reset` | — | The session could not be resumed; media are restarted. |
| `lost` | `reason` | The server gave up on the cloud (`core.giveUpAfter`). |
| `message` | `event, data` | A [notification](#custom-requests-and-notifications) from your server. |
| `session` | `mediaSession` | A low-level media session started. |

### Publish and play: xiombObject

`client.publish()` and `client.play()` return an `xiombObject`: a stream together with its player.

```js
const publisher = client.publish('room-7-alice', {
    targetEl: document.getElementById('me'),
    title: 'Alice',
    autoStart: false,
    constraints: {audio: true, video: {width: {ideal: 1920}, height: {ideal: 1080}}},
    codecList: ['H264'],
    custom: {roomID: 7},
});
publisher.on('status', status => console.log(status));
publisher.on('error', error => console.warn(error.name, error.message));
await publisher.start();

const viewer = client.play('room-7-alice', {
    targetEl: document.getElementById('alice'),
    transport: ['webrtc', 'hls'],
});
```

| Option | Default | Description |
|---|---|---|
| `targetEl` | — | Element (or jQuery object) to put the player in. Without it use `getPlayer().getElement()`. |
| `player` | — | An existing [xiombPlayer](#player-xiombplayer) instead of a new one. |
| `autoStart` | `true` for play, `false` for publish | Start at once. A publisher without `autoStart` opens the camera preview and waits for **Go live** or `start()`. |
| `title` | — | Caption in the player. |
| `textList` | — | Player texts, see [xiombPlayer](#player-xiombplayer). |
| `constraints` | 720p30 + audio | `getUserMedia` constraints for a publisher. |
| `transport` | `webrtc` | Viewer transport: `webrtc`, `hls` or a list in order of preference. Without WebRTC in the browser the SDK switches to HLS by itself. |
| `codecList` | — | Allowed video codecs in order of preference: `['H264']`, `['VP9', 'VP8']`. Other codecs are removed from the offer. |
| `custom` | — | Object (or `xiombObject => object`) passed to the `publish`/`play` hook. |

**Methods**

| Method | Description |
|---|---|
| `start()` | `Promise` — publish or play. Resolves when the stream is on. |
| `stop()` | `Promise` — stop; a publisher goes back to preview. |
| `capture()` | `Promise<MediaStream>` — open the camera and microphone without publishing. |
| `destroy()` | Stop and remove the player. |
| `getStatus()` | See statuses below. |
| `getID()` | Media ID while active (as on the server). |
| `getStreamName()`, `isPublish()`, `isActive()`, `isDestroyed()`, `getOptions()` | — |
| `getTransport()` | `webrtc` or `hls` while active. |
| `getPlayer()` | The [xiombPlayer](#player-xiombplayer). |
| `getMediaStream()` | The local camera (publish) or the received stream (play). |
| `getStat()`, `startStat(interval?)`, `stopStat()`, `getServerStat()` | [Statistics](#statistics). |

**Statuses**: `new` → `capture` → `preview` (publisher) → `connect` → `publish` / `play`; `reconnect` while the connection or the stream is being restored; `stop` (stopped or the stream ended); `failed` (with a message in the player); `destroy`.

**Events**

| Event | Arguments | When |
|---|---|---|
| `status` | `status, message` | Status changed. |
| `start` | `xiombObject` | Stream is on. |
| `stop` | `reason` | Stream stopped; `reason` is `null` for a normal stop or an error (e.g. `STREAM_ENDED`). |
| `error` | `error` | Any error: camera access, start, playback. |
| `state` | `connectionState` | WebRTC connection state. |
| `stat` | `stat` | Browser statistics, after `startStat()`. |
| `serverStat` | `stat` | Statistics from the cloud, every few seconds. |
| `destroy` | — | Destroyed. |

### Player: xiombPlayer

The player is created by `publish()`/`play()`, or on its own with `client.createPlayer(isPublish, targetEl, options)`. It renders a video with controls: start/stop, mute, camera off, device selection for a publisher, fullscreen, close. Style it with `xiombPlayer.css` or your own CSS; the root element has `data-status`, `data-active`, `data-muted`, `data-stream` attributes for styling.

**Methods**

| Method | Description |
|---|---|
| `getElement()`, `getVideoElement()` | Root element and `<video>`. |
| `play()`, `pause()`, `stop()` | Playback. If the browser blocks autoplay with sound, the player mutes itself and plays. |
| `mute()`, `unmute()`, `isMuted()` | Sound (a publisher mutes the microphone). |
| `muteVideo()`, `unmuteVideo()`, `isVideoMuted()` | Camera off/on for a publisher. |
| `setVolume(0..1)`, `getVolume()` | Volume. |
| `getDeviceList(kind?)` | `Promise` — cameras and microphones (`videoinput`, `audioinput`). |
| `setDevice(kind, deviceID)` | `Promise` — switch camera or microphone, also while live. |
| `getDeviceID(kind)`, `getDeviceName(kind)` | Current device. |
| `openSettings()`, `closeSettings()`, `toggleSettings()` | Device panel. |
| `setTitle(title)`, `setMessage(message)`, `setText(key, text)` | Texts. |
| `getVideoSize()` | `{width, height}`. |
| `isPlaying()`, `isCaptured()`, `getStatus()` | — |
| `destroy()` | Remove the player. |

**Events**: `request` (`'start'`/`'stop'`, a button pressed), `play`, `pause`, `stop`, `mute` (`bool`), `videoMute` (`bool`), `volume` (`number`), `device` (`kind, deviceID`), `deviceError` (`error`), `playError` (`error`), `ended` (`kind`, a camera or microphone was unplugged), `destroy`.

**Texts** (`textList` option or `setText`): `publishStart` (Go live), `publishStop`, `playStart` (Play), `playStop`, `preview`, `live`, `devices`, `camera`, `microphone`, `done`.

```js
client.publish('lobby', {
    targetEl: el,
    textList: {publishStart: 'Начать эфир', publishStop: 'Стоп', live: 'В эфире', preview: 'Превью'},
});
```

### Statistics

```js
viewer.startStat(1000);
viewer.on('stat', stat => {
    // stat.video: {codec, bitrate, width, height, fps, packetLostCount, frameDroppedCount, jitter, …}
    // stat.audio, stat.rtt, stat.status, stat.transport, stat.connectionState
    // stat.server: last statistics from the cloud
});
viewer.on('serverStat', stat => {
    // {ID, measuredAt, trackList, transcoderList, recording, viewers}
});
```

`getStat()` returns one sample as a `Promise`.

### Reconnect and restart

You do not need to handle failures yourself:

- **Connection to your server lost** — streams switch to `reconnect`, the SDK reconnects and restores them; WebRTC is renegotiated if needed.
- **Your server restarted** — the SDK takes its media back through the `resume` hook; with `resumeTimeout: 0` it restarts them instead.
- **Cloud region changed, a stream was interrupted** — publish and play restart by themselves with growing delays for up to 60 s (`MEDIA_TERMINATED`, `SERVICE_UNAVAILABLE`, `SESSION_RESET`, `MEDIA_NOT_FOUND`).
- **Publisher went away** — a viewer waits for the stream to come back (`STREAM_ENDED`, `STREAM_NOT_FOUND`, `STREAM_NOT_READY`) and plays it again.

Follow it with `status` (`reconnect` → `publish`/`play`) and `stop`/`error` for the final result.

## Errors

Errors are objects with `name` and `message`. In the SDK they are `xiombError` (`instanceof Error`); on the server — `ProjectError`. `client.getMessage(error)` turns an error into a text from `messageList`.

**From your server and the cloud**

| Name | Meaning |
|---|---|
| `FORBIDDEN` | A hook denied the action, or there is no such hook. |
| `BAD_REQUEST` | Invalid request. |
| `TIMEOUT` | A hook or the cloud did not answer in time. |
| `STREAM_NAME_INVALID` | Stream name has wrong characters or length. |
| `URI_INVALID` | Pull or push address is malformed, uses a forbidden scheme or characters. |
| `STREAM_NAME_TAKEN` | The name is already being published. |
| `STREAM_NOT_FOUND` | Nothing is published under this name. |
| `STREAM_NOT_READY` | The stream exists but has no media yet. |
| `STREAM_ENDED` | The publisher stopped. |
| `MEDIA_NOT_FOUND` | Unknown media ID. |
| `MEDIA_TERMINATED` | The media was closed by the server or the cloud. |
| `CODEC_UNSUPPORTED`, `SDP_INVALID` | WebRTC negotiation failed. |
| `CAPACITY_EXHAUSTED` | No free capacity right now. |
| `SERVICE_UNAVAILABLE` | The cloud is unreachable. |
| `INTERNAL` | Unexpected error, see your server log. |
| your own | Whatever you throw as `ProjectError` in hooks and handlers. |

**In the browser**

| Name | Meaning |
|---|---|
| `NOT_CONNECTED` | No connection to your server. |
| `NOT_SUPPORTED` | The browser lacks WebRTC, HLS or camera access. |
| `INSECURE_CONTEXT` | The camera needs `https://`. |
| `PERMISSION_DENIED` | Camera or microphone access denied. |
| `DEVICE_NOT_FOUND`, `DEVICE_BUSY` | No camera/microphone, or it is used by another app. |
| `CONSTRAINT_NOT_SATISFIED`, `INVALID_CONSTRAINTS` | The device cannot satisfy `constraints`. |
| `AUTOPLAY_BLOCKED` | The browser blocked playback until the user clicks. |
| `PLAY_FAILED`, `MEDIA_ERROR` | Playback or media error. |
| `STOPPED`, `DESTROYED` | `stop()`/`destroy()` was called during the start. |

## Browser support

- **Publish**: browsers with WebRTC and `getUserMedia` (Chrome, Edge, Firefox, Safari 11+, mobile Chrome and Safari), on `https://`.
- **Play over WebRTC**: the same browsers.
- **Play over HLS**: anything with Media Source Extensions and hls.js, or native HLS (Safari, iOS, Android); the ES5 build `xiomb.min.js` covers old browsers and TV/embedded engines.

## Demo

A full demo page with its project server is in the repository, [`js/demo/`](https://github.com/Xiomb/xiomb/tree/master/js/demo); it is not part of the npm package. From a clone of the repository:

```bash
cp js/demo/.env.example js/demo/.env   # fill in the values below
make demo                              # npm ci, build of the browser SDK, a self-signed certificate for localhost, start
```

Or by hand from `js/`:

```bash
npm install
npm run build
npm run demo:cert   # self-signed certificate in demo/ssl/ for localhost, once
npm run demo
```

| Variable | Value |
|---|---|
| `DEMO_CORE`, `DEMO_CORE_TLS` | Address of the xiomb cloud, e.g. `eu-test.xiomb.com` and `true`. |
| `DEMO_PROJECT_ID`, `DEMO_SECRET` | Project ID and secret key from [xiomb.com/projects](https://xiomb.com/projects). |
| `DEMO_HOST`, `DEMO_PORT`, `DEMO_SOCKET_PORT` | Host name of the demo for links and the browser, port of the page (`8443`) and of the SDK socket (`8444`). |
| `DEMO_CERT`, `DEMO_KEY` | Paths to the TLS certificate and key, relative to `js/demo/`. |
| `DEMO_LOGIN_FILE` | Where the demo keeps its logins (`logins.json`). |
| `DEMO_STREAMLINK` | Path to [streamlink](https://streamlink.github.io), used to pull Twitch and YouTube pages. Optional. |
| `DEMO_TWITCH_KEY`, `DEMO_YOUTUBE_KEY` | Stream keys for the restream presets. Optional. |

Open `https://<DEMO_HOST>:<DEMO_PORT>/`. With the self-signed certificate open `https://<DEMO_HOST>:<DEMO_SOCKET_PORT>/` once as well and accept it, otherwise the browser does not connect to the socket. The first login with a new name registers it; the same login and password then work for the page, for HLS, RTSP(S), RTMP(S) links and for OBS.

The server side of the demo is in two files: `server.mjs` creates the project and wires its hooks, events and requests, `helper.mjs` holds their implementation and the HTTP server of the page. The links on the page come from `project.getHlsURL()`, `getRtspURL()`, `getRtspsURL()`, `getRtmpURL()` and `getRtmpsURL()`.

Load test with viewers on the streams that are live now (needs `ffmpeg` for RTSP and RTMP):

```bash
cd js && npm run demo:load -- --login demo --password demo --transport hls --viewers 2
```

`--transport`: `hls`, `rtsp`, `rtsps`, `rtmp` or `rtmps`.

## License

MIT © Jaxima LLC
