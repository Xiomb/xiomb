import * as sdk from '/xiomb.mjs';

const $ = ID => document.getElementById(ID);
const STORAGE_KEY = 'xiombDemoUser';
const STATUS_TEXT = {connect: 'подключение', play: 'в эфире', push: 'в эфире', publish: 'в эфире', reconnect: 'переподключение', stop: 'остановлен'};

function el(tag, props = {}, ...childList) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...childList.filter(child => child != null));
    return node;
}

const icon = name => el('i', {className: `bi bi-${name}`});

function button(text, className, onClick, iconName) {
    const node = el('button', {type: 'button', className: `btn btn-sm ${className}`}, iconName ? icon(iconName) : null, text ? ` ${text}` : null);
    node.addEventListener('click', onClick);
    return node;
}

function log(message) {
    $('log').textContent += `${new Date().toLocaleTimeString()} ${message}\n`;
    $('log').scrollTop = $('log').scrollHeight;
}

function toast(message, isError = false) {
    const node = el('div', {className: `toast align-items-center border-0 text-bg-${isError ? 'danger' : 'dark'}`, role: 'status'},
        el('div', {className: 'd-flex'}, el('div', {className: 'toast-body', textContent: message}),
            el('button', {type: 'button', className: 'btn-close btn-close-white me-2 m-auto'})));
    node.querySelector('.btn-close').setAttribute('data-bs-dismiss', 'toast');
    $('toastList').append(node);
    node.addEventListener('hidden.bs.toast', () => node.remove());
    bootstrap.Toast.getOrCreateInstance(node, {delay: 3000}).show();
}

function fail(label, e) {
    log(`${label}: ${e.name} ${e.message}`);
    toast(`${label}: ${e.message || e.name}`, true);
}

function storage(action, value) {
    try {
        if (action === 'get') return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
        if (action === 'set') sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
        if (action === 'clear') sessionStorage.removeItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

async function copy(text) {
    try {
        await navigator.clipboard.writeText(text);
        toast('Скопировано');
    } catch {
        toast('Не удалось скопировать', true);
    }
}

const config = await (await fetch('/config.json')).json();

// ---------- вход ----------

async function checkLogin(login, password) {
    const response = await fetch('/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({login, password})});
    return response.ok;
}

function showLogin(error = '') {
    $('appView').classList.add('d-none');
    $('loginView').classList.remove('d-none');
    $('loginError').textContent = error;
    $('loginError').classList.toggle('d-none', !error);
    $('loginName').focus();
}

$('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const login = $('loginName').value.trim();
    const password = $('loginPassword').value;
    $('loginSubmit').disabled = true;
    try {
        if (!await checkLogin(login, password)) {
            showLogin('Неверный логин или пароль');
            return;
        }
        storage('set', {login, password});
        startApp(login, password);
    } catch {
        showLogin('Сервер недоступен');
    } finally {
        $('loginSubmit').disabled = false;
    }
});

$('logout').addEventListener('click', () => {
    storage('clear');
    location.hash = '';
    location.reload();
});

const savedUser = storage('get');
if (savedUser && await checkLogin(savedUser.login, savedUser.password).catch(() => false)) {
    startApp(savedUser.login, savedUser.password);
} else {
    storage('clear');
    showLogin();
}

// ---------- приложение ----------

function startApp(login, password) {
    $('loginView').classList.add('d-none');
    $('appView').classList.remove('d-none');
    $('userLogin').textContent = login;
    $('playName').value = 'cam';

    const xiomb = new sdk.xiomb({
        url: config.url,
        query: {auth_login: login, auth_password: password},
        messageList: {FORBIDDEN: 'Нет доступа', STREAM_NOT_FOUND: 'Поток не найден', PERMISSION_DENIED: 'Разрешите доступ к камере'},
    });

    function setState(text, color) {
        $('state').textContent = text;
        $('stateDot').className = `bi bi-circle-fill me-1 text-${color}`;
    }

    xiomb.on('disconnect', reason => {
        setState('переподключение…', 'warning');
        log(`sdk disconnect ${reason?.name ?? reason ?? ''}`);
    });
    xiomb.on('reconnect', () => {
        setState('подключено', 'success');
        log('sdk reconnect');
        loadAll();
    });
    xiomb.on('lost', () => {
        setState('связь потеряна', 'danger');
        log('sdk lost');
    });
    xiomb.on('message', (event, data) => {
        if (event === 'push.list') renderPushList(data.pushList);
        if (event === 'pull.list') renderPullList(data.pullList);
        if (event === 'stream.changed') loadStreamList();
    });

    const request = (type, data) => xiomb.request(type, data);

    // ---------- плитки плееров ----------

    function tile(containerID, mediaObject, label) {
        const caption = el('div', {className: 'small fw-semibold text-truncate'});
        const status = el('span', {className: 'badge text-bg-secondary'});
        const screen = el('div', {className: 'screen'}, mediaObject.getPlayer().getElement());
        const box = el('div', {className: 'col-md-6 col-xl-4'},
            el('div', {className: 'card h-100'},
                el('div', {className: 'card-body p-2'}, screen,
                    el('div', {className: 'd-flex align-items-center gap-2 mt-2'}, caption, status,
                        button('', 'btn-outline-secondary ms-auto', () => mediaObject.destroy(), 'x-lg')))));
        const update = () => {
            caption.textContent = label;
            caption.title = mediaObject.getID() ?? '';
            status.textContent = mediaObject.getStatus();
            status.className = `badge text-bg-${['publish', 'play'].includes(mediaObject.getStatus()) ? 'success' : mediaObject.getStatus() === 'failed' ? 'danger' : 'secondary'}`;
        };
        update();
        mediaObject.on('status', (value, message) => {
            update();
            log(`${label}: ${value}${message ? ` ${message}` : ''}`);
        });
        mediaObject.on('stop', reason => log(`${label}: stop${reason ? ` ${reason.name}` : ''}`));
        mediaObject.on('start', () => {
            update();
            log(`${label}: started, ID ${mediaObject.getID()}`);
            mediaObject.getMediaSession()?.on('restarted', update);
        });
        mediaObject.on('destroy', () => {
            log(`${label}: closed`);
            box.remove();
        });
        $(containerID).prepend(box);
    }

    async function startMedia(mediaObject) {
        try {
            await mediaObject.start();
        } catch (e) {
            log(`${mediaObject.getStreamName()}: ${e.name} ${e.message}`);
        }
    }

    function silentAudioTrack() {
        const audioContext = new AudioContext();
        const silence = audioContext.createConstantSource();
        const destination = audioContext.createMediaStreamDestination();
        silence.offset.value = 0;
        silence.connect(destination);
        silence.start();
        return destination.stream.getAudioTracks()[0];
    }

    function canvasStream() {
        const canvas = Object.assign(document.createElement('canvas'), {width: 1280, height: 720});
        const context = canvas.getContext('2d');
        const draw = () => {
            const now = new Date();
            context.fillStyle = `hsl(${(now.getTime() / 50) % 360}, 60%, 35%)`;
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = '#fff';
            context.font = '120px system-ui';
            context.textAlign = 'center';
            context.fillText(now.toLocaleTimeString(), canvas.width / 2, canvas.height / 2 + 40);
            context.font = '40px system-ui';
            context.fillText(login, canvas.width / 2, canvas.height - 60);
        };
        // таймер воркера не замирает в фоновой вкладке
        const ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 40);'], {type: 'text/javascript'})));
        ticker.onmessage = draw;
        draw();
        const stream = canvas.captureStream(25);
        stream.addTrack(silentAudioTrack());
        return stream;
    }

    async function screenStream() {
        const stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: true});
        if (!stream.getAudioTracks().length) stream.addTrack(silentAudioTrack());
        return stream;
    }

    $('publishStart').addEventListener('click', async () => {
        const name = $('publishName').value.trim();
        const source = $('publishSource').value;
        const codec = $('publishCodec').value;
        const options = {autoStart: false, title: name, ...(codec ? {codecList: [codec]} : {})};
        if (source === 'camera') {
            const mediaObject = xiomb.publish(name, {...options, constraints: {audio: true, video: {width: {ideal: 1280}, height: {ideal: 720}}}});
            tile('publishTiles', mediaObject, `${name} · камера`);
            return;
        }
        try {
            const stream = source === 'screen' ? await screenStream() : canvasStream();
            const mediaObject = xiomb.publish(name, options);
            mediaObject.getPlayer().setMediaStream(stream, true);
            tile('publishTiles', mediaObject, `${name} · ${source === 'screen' ? 'экран' : 'картинка'}`);
            startMedia(mediaObject);
        } catch (e) {
            fail('publish', e);
        }
    });

    function play(name, transport) {
        const mediaObject = xiomb.play(name, {transport, title: name});
        tile('playTiles', mediaObject, `${name} · ${transport}`);
    }

    const showTab = paneID => bootstrap.Tab.getOrCreateInstance(document.querySelector(`[data-bs-target="#${paneID}"]`)).show();

    $('playStart').addEventListener('click', () => {
        const name = $('playName').value.trim();
        if (name) play(name, $('playTransport').value);
    });

    // ---------- мои потоки ----------

    function trackText(track) {
        if (track.kind === 'video') return `${track.codec} ${track.width ?? '?'}×${track.height ?? '?'}${track.fps ? ` ${Math.round(track.fps)}fps` : ''}`;
        return track.codec;
    }

    function renderStreamList(streamList) {
        $('streamNameList').replaceChildren(...streamList.map(stream => el('option', {value: stream.name})));
        if (!streamList.length) {
            $('streamList').replaceChildren(el('tr', {}, el('td', {colSpan: 7, className: 'text-body-secondary text-center py-4', textContent: 'Нет потоков в эфире'})));
            return;
        }
        $('streamList').replaceChildren(...streamList.map(stream => {
            const snapshot = stream.snapshotURL
                ? el('img', {className: 'snapshot', src: stream.snapshotURL, alt: ''})
                : el('span', {className: 'text-body-secondary', textContent: '—'});
            snapshot.addEventListener('click', () => stream.snapshotURL && showSnapshot(stream.name, stream.snapshotURL));
            const recordingList = stream.recordingURLList.length
                ? el('div', {className: 'dropdown d-inline-block'},
                    el('button', {type: 'button', className: 'btn btn-sm btn-link dropdown-toggle', textContent: `файлы (${stream.recordingURLList.length})`}),
                    el('ul', {className: 'dropdown-menu'}, ...stream.recordingURLList.map((url, index) =>
                        el('li', {}, el('a', {className: 'dropdown-item small', href: url, target: '_blank', textContent: `Запись ${index + 1}`})))))
                : null;
            recordingList?.querySelector('button').setAttribute('data-bs-toggle', 'dropdown');
            const recordSwitch = el('input', {type: 'checkbox', className: 'form-check-input', checked: stream.recording, role: 'switch'});
            recordSwitch.addEventListener('change', async () => {
                try {
                    await request('stream.record', {name: stream.name, enabled: recordSwitch.checked});
                    log(`${stream.name}: запись ${recordSwitch.checked ? 'включена' : 'выключена'}`);
                    setTimeout(loadStreamList, 1000);
                } catch (e) {
                    recordSwitch.checked = !recordSwitch.checked;
                    fail('record', e);
                }
            });
            return el('tr', {},
                el('td', {}, el('div', {className: 'fw-semibold', textContent: stream.name}),
                    el('div', {className: 'small text-body-secondary', textContent: new Date(stream.createdAt).toLocaleTimeString()})),
                el('td', {}, el('span', {className: 'badge text-bg-light border', textContent: stream.transport})),
                el('td', {className: 'small', textContent: stream.trackList.map(trackText).join(', ') || '—'}),
                el('td', {title: stream.viewerList.map(viewer => `${viewer.userID} ${viewer.transport}`).join('\n'), textContent: stream.viewers}),
                el('td', {}, snapshot),
                el('td', {}, el('div', {className: 'form-check form-switch d-inline-block me-1'}, recordSwitch), recordingList),
                el('td', {className: 'text-end text-nowrap'},
                    button('', 'btn-outline-primary me-1', () => {
                        play(stream.name, 'webrtc');
                        showTab('tabPlay');
                    }, 'play-fill'),
                    button('', 'btn-outline-secondary me-1', () => takeSnapshot(stream.name), 'camera'),
                    button('', 'btn-outline-secondary me-1', () => {
                        $('linkName').value = stream.name;
                        renderLinkList();
                        showTab('tabLinks');
                    }, 'link-45deg'),
                    button('', 'btn-outline-danger', async () => {
                        try {
                            await request('stream.kill', {name: stream.name});
                            log(`${stream.name}: остановлен`);
                            loadStreamList();
                        } catch (e) {
                            fail('kill', e);
                        }
                    }, 'stop-fill')));
        }));
    }

    async function loadStreamList() {
        try {
            renderStreamList((await request('stream.list')).streamList);
        } catch (e) {
            log(`stream.list: ${e.name} ${e.message}`);
        }
    }

    function showSnapshot(name, url) {
        $('snapshotTitle').textContent = name;
        $('snapshotImage').src = url;
        bootstrap.Modal.getOrCreateInstance($('snapshotModal')).show();
    }

    async function takeSnapshot(name) {
        try {
            const {url} = await request('stream.snapshot', {name});
            log(`${name}: снимок ${url}`);
            showSnapshot(name, url);
            loadStreamList();
        } catch (e) {
            fail('snapshot', e);
        }
    }

    $('streamRefresh').addEventListener('click', loadStreamList);
    setInterval(() => {
        if ($('tabStreams').classList.contains('active') && xiomb.isConnected()) loadStreamList();
    }, 5000);

    // ---------- pull и push ----------

    function renderList(tbodyID, infoList, columnList, onStop) {
        if (!infoList.length) {
            $(tbodyID).replaceChildren(el('tr', {}, el('td', {colSpan: columnList.length + 2, className: 'text-body-secondary text-center py-3', textContent: 'Пусто'})));
            return;
        }
        $(tbodyID).replaceChildren(...infoList.map(info => el('tr', {},
            ...columnList.map(column => el('td', {className: 'text-break', textContent: info[column]})),
            el('td', {className: `status-${info.status}`, textContent: (STATUS_TEXT[info.status] ?? info.status) + (info.reason ? ` (${info.reason})` : '')}),
            el('td', {className: 'text-end text-nowrap'},
                info.status !== 'stop' ? button('', 'btn-outline-primary me-1', () => {
                    play(info.name, 'webrtc');
                    showTab('tabPlay');
                }, 'play-fill') : null,
                info.status !== 'stop' ? button('Остановить', 'btn-outline-danger', async () => {
                    try {
                        await onStop(info);
                        log(`${info.name}: остановлен`);
                    } catch (e) {
                        fail('stop', e);
                    }
                }) : null))));
    }

    const renderPushList = pushList => renderList('pushList', pushList, ['name', 'target'], info => request('push.stop', {ID: info.ID}));
    const renderPullList = pullList => renderList('pullList', pullList, ['source', 'name'], info => request('pull.stop', {key: info.key}));

    for (const preset of config.pushPresetList ?? []) {
        $('pushPreset').append(el('option', {value: preset.uri, textContent: preset.name}));
    }
    for (const kind of ['push', 'pull']) {
        $(`${kind}Preset`).addEventListener('change', () => {
            const input = $(`${kind}URI`);
            input.value = $(`${kind}Preset`).value;
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        });
    }

    $('pushStart').addEventListener('click', async () => {
        const body = {
            name: $('pushName').value.trim(),
            uri: $('pushURI').value.trim(),
            videoCodec: $('pushVideoCodec').value,
            videoBitrate: $('pushVideoBitrate').value,
            audioBitrate: $('pushAudioBitrate').value,
        };
        $('pushStart').disabled = true;
        try {
            const info = await request('push.start', body);
            log(`push ${info.name} -> ${info.target}: запущен, ID ${info.ID}`);
        } catch (e) {
            fail(`push ${body.name}`, e);
        } finally {
            $('pushStart').disabled = false;
        }
    });

    async function startPull() {
        const body = {
            uri: $('pullURI').value.trim(),
            name: $('pullName').value.trim(),
            rtspTransport: $('pullRtspTransport').value,
            loop: $('pullLoop').checked,
        };
        $('pullStart').disabled = $('pullRandom').disabled = true;
        try {
            const info = await request('pull.start', body);
            log(`pull ${info.source} -> ${info.name}: запущен`);
            toast(`Поток «${info.name}» запущен`);
        } catch (e) {
            fail(`pull ${body.uri}`, e);
        } finally {
            $('pullStart').disabled = $('pullRandom').disabled = false;
        }
    }

    const pullFileList = [...$('pullPreset').options].map(option => option.value).filter(value => value.startsWith('file://'));
    $('pullStart').addEventListener('click', startPull);
    $('pullStopAll').addEventListener('click', async () => {
        try {
            const {stopped} = await request('pull.stopAll');
            log(`pull: остановлено ${stopped}`);
            toast(`Остановлено: ${stopped}`);
        } catch (e) {
            fail('pull stop', e);
        }
    });
    $('pullRandom').addEventListener('click', () => {
        const uri = pullFileList[Math.floor(Math.random() * pullFileList.length)];
        $('pullPreset').value = uri;
        $('pullURI').value = uri;
        $('pullStart').click();
    });

    // ---------- ссылки ----------

    const encode = encodeURIComponent;
    const authQuery = `auth_login=${encode(login)}&auth_password=${encode(password)}`;
    let linkRequestID = 0;

    function linkItem(title, valueList, openURL) {
        return el('li', {className: 'list-group-item link-row'},
            el('div', {className: 'd-flex align-items-center mb-1'},
                el('span', {className: 'small fw-semibold', textContent: title}),
                openURL ? el('a', {className: 'btn btn-sm btn-link ms-auto py-0', href: openURL, target: '_blank', textContent: 'открыть'}) : null),
            ...valueList.map(([label, value]) => el('div', {className: 'd-flex align-items-start gap-2 mb-1'},
                label ? el('span', {className: 'small text-body-secondary text-nowrap', style: 'min-width: 70px', textContent: label}) : null,
                el('code', {className: 'small flex-fill', textContent: value}),
                button('', 'btn-outline-secondary py-0', () => copy(value), 'clipboard'))));
    }

    function serverOf(url) {
        const parsed = new URL(url);
        parsed.pathname = parsed.pathname.replace(/\/[^/]*$/, '');
        return parsed.toString();
    }

    async function renderLinkList() {
        const stream = $('linkName').value.trim();
        const requestID = ++linkRequestID;
        let linkMap = {};
        try {
            const response = await fetch(`/links.json?name=${encode(stream)}&${authQuery}`);
            linkMap = await response.json();
            if (!response.ok) {
                throw new Error(linkMap.message || linkMap.name);
            }
        } catch (e) {
            linkMap = {};
            log(`links: ${e.message}`);
        }
        if (requestID !== linkRequestID) {
            return;
        }
        const {hls: hlsURL, rtsp: rtspURL, rtsps: rtspsURL, rtmp: rtmpURL, rtmps: rtmpsURL} = linkMap;
        const pageURL = `${config.pageURL}#play=${encode(stream)}`;
        const testSource = '-re -f lavfi -i testsrc2=size=1280x720:rate=25 -f lavfi -i sine=frequency=440 -c:v libx264 -preset veryfast -tune zerolatency -g 50 -pix_fmt yuv420p -c:a aac';
        $('publishLinkList').replaceChildren(...[
            rtmpURL && linkItem('OBS · RTMP', [['Сервер', serverOf(rtmpURL)], ['Ключ', stream]]),
            rtmpsURL && linkItem('OBS · RTMPS', [['Сервер', serverOf(rtmpsURL)], ['Ключ', stream]]),
            linkItem('OBS · WHIP (WebRTC)', [['Сервер', `${config.whipURL}/${stream}?auth_login=${encode(login)}`], ['Bearer', password]]),
            rtmpURL && linkItem('RTMP', [['', rtmpURL]]),
            rtmpsURL && linkItem('RTMPS', [['', rtmpsURL]]),
            rtspURL && linkItem('RTSP (камера, энкодер)', [['', rtspURL]]),
            rtspsURL && linkItem('RTSPS (камера, энкодер)', [['', rtspsURL]]),
            rtmpURL && linkItem('ffmpeg → RTMP, тестовый сигнал', [['', `ffmpeg ${testSource} -f flv "${rtmpURL}"`]]),
            rtspURL && linkItem('ffmpeg → RTSP, тестовый сигнал', [['', `ffmpeg ${testSource} -f rtsp -rtsp_transport tcp "${rtspURL}"`]]),
        ].filter(Boolean));
        $('playLinkList').replaceChildren(...[
            linkItem('Страница демо · WebRTC', [['', pageURL]], pageURL),
            linkItem('Страница демо · HLS', [['', `${pageURL}&transport=hls`]], `${pageURL}&transport=hls`),
            hlsURL && linkItem('HLS (браузер, ТВ, VLC)', [['', hlsURL]], hlsURL),
            rtspURL && linkItem('RTSP (VLC, ffplay)', [['', rtspURL]]),
            rtspsURL && linkItem('RTSPS', [['', rtspsURL]]),
            rtmpURL && linkItem('RTMP', [['', rtmpURL]]),
            rtmpsURL && linkItem('RTMPS', [['', rtmpsURL]]),
            (rtspURL || hlsURL) && linkItem('ffplay', [
                ...rtspURL ? [['RTSP', `ffplay -rtsp_transport tcp "${rtspURL}"`]] : [],
                ...hlsURL ? [['HLS', `ffplay "${hlsURL}"`]] : [],
            ]),
        ].filter(Boolean));
    }

    $('linkName').addEventListener('input', renderLinkList);
    renderLinkList();

    $('logClear').addEventListener('click', () => $('log').textContent = '');

    // ---------- вкладки и ссылка #play= ----------

    try {
        const savedTab = localStorage.getItem('xiombDemoTab');
        if (savedTab && $(savedTab)) showTab(savedTab);
    } catch {}
    for (const node of document.querySelectorAll('#tabList [data-bs-toggle="tab"]')) {
        node.addEventListener('shown.bs.tab', () => {
            const paneID = node.dataset.bsTarget.slice(1);
            try {
                localStorage.setItem('xiombDemoTab', paneID);
            } catch {}
            if (paneID === 'tabStreams') loadStreamList();
        });
    }

    function playFromHash() {
        const hashParams = new URLSearchParams(location.hash.slice(1));
        const name = hashParams.get('play');
        if (!name) return;
        const transport = hashParams.get('transport') === 'hls' ? 'hls' : 'webrtc';
        $('playName').value = name;
        $('playTransport').value = transport;
        showTab('tabPlay');
        play(name, transport);
        history.replaceState(null, '', location.pathname);
    }

    function loadAll() {
        request('push.list').then(data => renderPushList(data.pushList), e => log(`push.list: ${e.name}`));
        request('pull.list').then(data => renderPullList(data.pullList), e => log(`pull.list: ${e.name}`));
        loadStreamList();
    }

    setState('подключение…', 'warning');
    xiomb.connect().then(() => {
        setState('подключено', 'success');
        log(`sdk connected ${config.url} as ${login}`);
        loadAll();
        playFromHash();
    }, e => {
        setState('ошибка', 'danger');
        fail('connect', e);
    });
}
