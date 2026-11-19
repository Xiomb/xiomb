# xiomb

Server SDK and browser SDK for [xiomb](https://xiomb.com), a cloud audio/video streaming server with WebRTC, HLS, RTSP, RTMP and VOD.

- **Live in the browser**: publish a camera and microphone over WebRTC, watch over WebRTC (sub-second latency) or HLS.
- **Any source**: IP cameras and encoders publish over RTSP or RTMP (OBS, ffmpeg); the cloud can also pull an RTSP/HTTP source by itself.
- **Recording and snapshots**: record a live stream to a file (VOD) and take JPEG snapshots on demand.
- **Your rules**: every connection, publish and play goes through hooks in your own server, so access control stays in your code.
- **Survives failures**: the SDK reconnects, resumes sessions and restarts streams by itself; the server follows the project when it moves to another region.

## How it works

```
 Browser (SDK)  ── WebSocket ──>  Your project server (this SDK)  ────── gRPC ──>  xiomb cloud
       │                                    │                                        │
       └──────────── WebRTC / HLS media ────┼────────────────────────────────────────┘
 Cameras, OBS ─────────── RTSP / RTMP ──────┴──── hook "rtsp" asks your server ──────┘
```

1. You create a project at [xiomb.com/projects](https://xiomb.com/projects) and get a **project ID** and a **secret key**.
2. You run the **project server** next to your application. It connects to the xiomb cloud (`c.xiomb.com:443` by default) with the project ID and secret, and opens a WebSocket for your users.
3. Your web page uses the **browser SDK**. It connects to your project server, not to the cloud, so the server decides who may connect, publish and play.
4. Media goes directly between the browser and the cloud; your server only handles signalling and decisions. For WebRTC the browser gets STUN and TURN from the cloud with a one-time TURN login for each connection; no TURN credentials live in your page.

The secret never leaves your server. The browser only knows the address of your project server and whatever token your application gives it.

## Packages

| Directory | Package | Install |
|---|---|---|
| [`js/`](js/README.md) | npm [`xiomb`](https://www.npmjs.com/package/xiomb): Node.js server and browser SDK | `npm install xiomb` |

The browser SDK (`xiomb/sdk`, also on [unpkg](https://unpkg.com/xiomb/sdk/xiomb.min.js) and [jsDelivr](https://cdn.jsdelivr.net/npm/xiomb/sdk/xiomb.min.js)): see [Browser SDK](js/README.md#browser-sdk). The full reference is [js/README.md](js/README.md).

## Quick start

```js
import {XiombProject} from 'xiomb';

const project = new XiombProject({
    core: {projectID: process.env.XIOMB_PROJECT_ID, secret: process.env.XIOMB_SECRET},
    socket: {port: 8443, https: {cert: 'fullchain.pem', key: 'privkey.pem'}},
});
project.use('auth', socket => ({ID: socket.getQueryVal('user')}));
project.use('publish', () => true);
project.use('play', () => true);
await project.start();
```

```html
<link rel="stylesheet" href="https://unpkg.com/xiomb/sdk/xiombPlayer.min.css">
<div id="publisher" style="width: 640px; height: 360px"></div>
<div id="viewer" style="width: 640px; height: 360px"></div>

<script type="module">
    import {xiomb} from 'https://unpkg.com/xiomb/sdk/xiomb.min.mjs';

    const client = new xiomb({url: 'wss://example.com:8443', query: {user: 'alice'}});
    client.publish('cam', {targetEl: document.getElementById('publisher')});
    client.play('cam', {targetEl: document.getElementById('viewer')});
</script>
```

## Repository layout

```
proto/   gRPC protocol between a project server and the cloud
js/      npm package: Node.js server (src/) and browser SDK (sdk/)
```

## Build and test

Node.js 18+. The tests run without the cloud. From the root:

```bash
make test        # npm test in js/
make build       # browser SDK
```

## Releases

Version in `js/package.json`, publish with `cd js && npm publish` (`prepack` copies `proto/` into the package).

## License

[MIT](LICENSE)
