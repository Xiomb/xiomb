// Нагрузка зрителями на потоки, которые сейчас в эфире.
// node loadtest/viewers.mjs --login demo --password demo --transport hls --viewers 2 --match '^pull-'
import {spawn} from "node:child_process";
import {parseArgs} from "node:util";

const {values: argMap} = parseArgs({
    options: {
        demo: {type: 'string', default: 'https://localhost:8443'},
        login: {type: 'string', default: 'demo'},
        password: {type: 'string', default: 'demo'},
        transport: {type: 'string', default: 'hls'},
        viewers: {type: 'string', default: '1'},
        match: {type: 'string', default: ''},
        limit: {type: 'string', default: '0'},
        ramp: {type: 'string', default: '20'},
        duration: {type: 'string', default: '0'},
        ffmpeg: {type: 'string', default: 'ffmpeg'},
        secure: {type: 'boolean', default: false},
    },
});

if (!argMap.secure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
const TRANSPORT = argMap.transport;
if (!['hls', 'rtsp', 'rtsps', 'rtmp', 'rtmps'].includes(TRANSPORT)) {
    throw new Error('Unknown transport');
}
const VIEWERS = Number(argMap.viewers);
const RAMP_MS = Number(argMap.ramp);
const DURATION_MS = Number(argMap.duration) * 1000;
const RETRY_MS = 2000;
const ALIVE_MS = 10000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const encode = encodeURIComponent;
const authQuery = `auth_login=${encode(argMap.login)}&auth_password=${encode(argMap.password)}`;

const loginResponse = await fetch(new URL('/login', argMap.demo), {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({login: argMap.login, password: argMap.password}),
});
if (!loginResponse.ok) {
    throw new Error(`Login ${loginResponse.status}`);
}
const streamResponse = await fetch(new URL(`/streams.json?${authQuery}`, argMap.demo));
if (!streamResponse.ok) {
    throw new Error(`Stream list ${streamResponse.status}`);
}
const matchRE = new RegExp(argMap.match);
let streamNameList = (await streamResponse.json()).streamList.map(stream => stream.name).filter(name => matchRE.test(name)).sort();
if (Number(argMap.limit) > 0) {
    streamNameList = streamNameList.slice(0, Number(argMap.limit));
}
if (!streamNameList.length) {
    throw new Error('Stream not found');
}

const linkMap = new Map();
for (const name of streamNameList) {
    const response = await fetch(new URL(`/links.json?name=${encode(name)}&${authQuery}`, argMap.demo));
    const url = response.ok ? (await response.json())[TRANSPORT] : null;
    if (!url) {
        throw new Error(`Link ${TRANSPORT} not found`);
    }
    linkMap.set(name, url);
}

const linkOf = name => linkMap.get(name);

const stat = {bytes: 0, errors: 0, restarts: 0, errorNameMap: new Map()};
const viewerList = [];
let stopped = false;

function countError(name) {
    stat.errors++;
    stat.errorNameMap.set(name, (stat.errorNameMap.get(name) ?? 0) + 1);
}

// HLS: плейлист и сегменты как у плеера, байты не декодируются
async function readBody(response, viewer) {
    for await (const chunk of response.body) {
        stat.bytes += chunk.length;
        viewer.dataAt = Date.now();
    }
}

const uriListOf = text => text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));

async function hlsSession(viewer) {
    let response = await fetch(viewer.link, {signal: viewer.abort.signal});
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    let playlistURL = response.url;
    let text = await response.text();
    if (text.includes('#EXT-X-STREAM-INF')) {
        playlistURL = new URL(uriListOf(text)[0], playlistURL).href;
        text = null;
    }
    let seenSet = new Set();
    while (!stopped) {
        if (text === null) {
            response = await fetch(playlistURL, {signal: viewer.abort.signal});
            if (!response.ok) throw new Error(`HTTP_${response.status}`);
            text = await response.text();
        }
        const targetDuration = Number(/#EXT-X-TARGETDURATION:(\d+(\.\d+)?)/.exec(text)?.[1] ?? 2);
        const uriList = uriListOf(text);
        // первый заход — с последнего сегмента, как живой плеер
        const newList = seenSet.size ? uriList.filter(uri => !seenSet.has(uri)) : uriList.slice(-1);
        for (const uri of newList) {
            const segment = await fetch(new URL(uri, playlistURL), {signal: viewer.abort.signal});
            if (!segment.ok) throw new Error(`HTTP_${segment.status}`);
            await readBody(segment, viewer);
        }
        seenSet = new Set(uriList);
        if (text.includes('#EXT-X-ENDLIST')) throw new Error('ENDLIST');
        text = null;
        await sleep(newList.length ? targetDuration * 1000 : targetDuration * 500);
    }
}

// RTSP/RTMP: ffmpeg без перекодирования, вывод в никуда
function ffmpegSession(viewer) {
    return new Promise((resolve, reject) => {
        const inputList = TRANSPORT.startsWith('rtsp') ? ['-rtsp_transport', 'tcp', '-i', viewer.link] : ['-i', viewer.link];
        const child = spawn(argMap.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...inputList,
            '-c', 'copy', '-f', 'null', '-progress', 'pipe:1', '-stats_period', '2', '-'], {stdio: ['ignore', 'pipe', 'pipe']});
        viewer.child = child;
        let lastSize = 0;
        let errorText = '';
        child.stdout.on('data', chunk => {
            for (const match of String(chunk).matchAll(/total_size=(\d+)/g)) {
                const size = Number(match[1]);
                if (size > lastSize) {
                    stat.bytes += size - lastSize;
                    lastSize = size;
                    viewer.dataAt = Date.now();
                }
            }
        });
        child.stderr.on('data', chunk => errorText = String(chunk).trim().split('\n').pop());
        child.on('error', reject);
        child.on('exit', code => code === 0 || stopped ? resolve() : reject(new Error(errorText.slice(0, 60) || `EXIT_${code}`)));
    });
}

async function runViewer(viewer) {
    while (!stopped) {
        viewer.abort = new AbortController();
        try {
            await (TRANSPORT === 'hls' ? hlsSession(viewer) : ffmpegSession(viewer));
        } catch (e) {
            if (stopped) return;
            countError(e.cause?.code ?? (e.name === 'Error' ? e.message : e.name));
        }
        stat.restarts++;
        await sleep(RETRY_MS);
    }
}

function report() {
    const now = Date.now();
    const alive = viewerList.filter(viewer => now - viewer.dataAt < ALIVE_MS).length;
    const mbit = (stat.bytes * 8 / 1e6 / 5).toFixed(1);
    const errorText = [...stat.errorNameMap].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, count]) => `${name}:${count}`).join(' ');
    console.log(`${new Date().toLocaleTimeString()} ${TRANSPORT} viewers ${alive}/${viewerList.length} alive, ${mbit} Mbit/s, errors ${stat.errors}, restarts ${stat.restarts}${errorText ? ` [${errorText}]` : ''}`);
    stat.bytes = 0;
}

function stop() {
    if (stopped) return;
    stopped = true;
    for (const viewer of viewerList) {
        viewer.abort?.abort();
        viewer.child?.kill('SIGTERM');
    }
    report();
    setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(report, 5000);
if (DURATION_MS > 0) setTimeout(stop, DURATION_MS);

console.log(`${streamNameList.length} streams × ${VIEWERS} viewers = ${streamNameList.length * VIEWERS} ${TRANSPORT} viewers, ramp ${RAMP_MS} ms`);
for (let index = 0; index < VIEWERS && !stopped; index++) {
    for (const name of streamNameList) {
        if (stopped) break;
        const viewer = {name, link: linkOf(name), dataAt: 0, abort: null, child: null};
        viewerList.push(viewer);
        runViewer(viewer);
        await sleep(RAMP_MS);
    }
}
