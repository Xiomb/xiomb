const getValue = value => value === undefined ? null : value;

export class xiombStat {
    #isPublish;
    #lastByteMap = {};

    constructor(isPublish) {
        this.#isPublish = isPublish;
    }

    #createTrackStat(report, item) {
        const byteCount = (this.#isPublish ? item.bytesSent : item.bytesReceived) || 0;
        const lastByte = this.#lastByteMap[item.id];
        const seconds = lastByte ? (item.timestamp - lastByte.timestamp) / 1000 : 0;
        const codec = item.codecId ? report.get(item.codecId) : null;
        this.#lastByteMap[item.id] = {byteCount, timestamp: item.timestamp};
        return {
            codec: codec && codec.mimeType ? codec.mimeType.split('/')[1] : null,
            bitrate: seconds > 0 ? Math.round((byteCount - lastByte.byteCount) * 8 / seconds) : 0,
            byteCount,
            packetCount: getValue(this.#isPublish ? item.packetsSent : item.packetsReceived),
            packetLostCount: getValue(item.packetsLost),
            jitter: getValue(item.jitter),
            width: getValue(item.frameWidth),
            height: getValue(item.frameHeight),
            fps: getValue(item.framesPerSecond),
            frameDroppedCount: getValue(item.framesDropped),
        };
    }

    reset() {
        this.#lastByteMap = {};
    }

    async collect(peerConnection) {
        const stat = {timestamp: Date.now(), video: null, audio: null, rtt: null, remotePacketLostList: {}};
        if (!peerConnection) {
            return stat;
        }
        const report = await peerConnection.getStats();
        const rtpType = this.#isPublish ? 'outbound-rtp' : 'inbound-rtp';
        report.forEach(item => {
            const kind = item.kind || item.mediaType;
            const isMediaKind = kind === 'video' || kind === 'audio';
            if (item.type === rtpType && !item.isRemote) {
                if (isMediaKind) {
                    stat[kind] = this.#createTrackStat(report, item);
                }
            } else if (item.type === 'candidate-pair' && item.nominated && item.state === 'succeeded') {
                stat.rtt = getValue(item.currentRoundTripTime);
            } else if (this.#isPublish && item.type === 'remote-inbound-rtp' && isMediaKind) {
                stat.remotePacketLostList[kind] = getValue(item.packetsLost);
            }
        });
        return stat;
    }
}
