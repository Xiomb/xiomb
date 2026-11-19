import {XiombProject} from "../index.js";
import * as helper from "./helper.mjs";

const {core, socket} = helper.getSettings();

const project = new XiombProject({
    core: {...core, reconnectMax: 2000},
    socket,
    logger: helper.log,
});
helper.setProject(project);

project.use('auth', helper.onAuth);
project.use('publish', helper.onPublish);
project.use('play', helper.onPlay);
project.use('resume', helper.onResume);

project.on('core|disconnect', helper.onCoreDisconnect);
project.on('core|reconnect', helper.onCoreReconnect);
project.on('client|destroy', helper.onClientDestroy);
project.on('stream|started', helper.onStreamStarted);
project.on('stream|ended', helper.onStreamEnded);
project.on('media', helper.onMedia);
project.on('media|destroy', helper.onMediaDestroy);

project.handle('stream.list', helper.onStreamList);
project.handle('stream.snapshot', helper.onStreamSnapshot);
project.handle('stream.record', helper.onStreamRecord);
project.handle('stream.kill', helper.onStreamKill);
project.handle('push.list', helper.onPushList);
project.handle('push.start', helper.onPushStart);
project.handle('push.stop', helper.onPushStop);
project.handle('pull.list', helper.onPullList);
project.handle('pull.start', helper.onPullStart);
project.handle('pull.stop', helper.onPullStop);
project.handle('pull.stopAll', helper.onPullStopAll);

await project.start();

helper.startHttpServer();
