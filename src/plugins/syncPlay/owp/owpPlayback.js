import { playbackManager } from '../../../components/playback/playbackmanager';
import Events from '../../../utils/events';

const DRIFT_DEADZONE_SEC = 0.04;
const DRIFT_SOFT_MAX_SEC = 2.0;
const PLAYBACK_RATE_MIN = 0.85;
const PLAYBACK_RATE_MAX = 2.0;
const DRIFT_GAIN = 0.50;
const SYNC_LOOP_MS = 500;
const STATE_UPDATE_INTERVAL_MS = 1000;

class OWPPlayback {
    constructor() {
        this.client = null;
        this.video = null;
        this.videoListeners = null;

        this.isSyncing = false;
        this.isBuffering = false;
        this.syncingTimeout = null;

        this.lastSyncPosition = 0;
        this.lastSyncServerTs = 0;
        this.lastSyncPlayState = 'paused';

        this.syncLoopTimer = null;
        this.hostStateTimer = null;

        this.lastHostSeekSentAt = 0;
        this.lastHostSentPosition = 0;
    }

    init(owpClient) {
        this.client = owpClient;

        this.client.on('room-joined', (data) => this.onRoomJoined(data));
        this.client.on('room-left', () => this.onRoomLeft());
        this.client.on('player-event', (payload, serverTs) => this.onPlayerEvent(payload, serverTs));
        this.client.on('state-update', (payload, serverTs) => this.onStateUpdate(payload, serverTs));

        Events.on(playbackManager, 'playerchange', () => this.bindCurrentVideo());
        Events.on(playbackManager, 'playbackstart', () => this.bindCurrentVideo());
        Events.on(playbackManager, 'playbackstop', () => {
            this.normalizePlaybackRate();
            this.unbindVideo();
            if (this.client?.isInRoom()) {
                this.client.leaveRoom();
            }
        });

        this.bindCurrentVideo();
    }

    getVideo() {
        return document.querySelector('video');
    }

    startSyncing(durationMs = 2000) {
        this.isSyncing = true;
        if (this.syncingTimeout) clearTimeout(this.syncingTimeout);
        this.syncingTimeout = setTimeout(() => {
            this.isSyncing = false;
            this.syncingTimeout = null;
        }, durationMs);
    }

    normalizePlaybackRate() {
        const video = this.video || this.getVideo();
        if (video && video.playbackRate !== 1) {
            video.playbackRate = 1;
        }
    }

    broadcastHost(action) {
        if (!this.client.isHost || this.isSyncing) return;
        const video = this.video || this.getVideo();
        if (!video) return;

        const playState = video.paused ? 'paused' : 'playing';
        this.client.sendPlayerEvent(action, video.currentTime, playState);
        this.client.sendStateUpdate(video.currentTime, playState);
    }

    bindCurrentVideo() {
        const video = this.getVideo();
        if (!video) return;
        if (this.video === video && this.videoListeners) return;

        this.unbindVideo();
        this.video = video;

        const onPlay = () => this.broadcastHost('play');

        const onPause = () => {
            if (!this.isBuffering && !video.seeking) {
                this.broadcastHost('pause');
            }
        };

        const onSeeked = () => {
            if (this.client.isHost && !this.isSyncing) {
                const now = Date.now();
                if (now - this.lastHostSeekSentAt < 250) return;
                if (Math.abs(video.currentTime - this.lastHostSentPosition) < 0.5) return;
                this.lastHostSeekSentAt = now;
                this.lastHostSentPosition = video.currentTime;
                this.broadcastHost('seek');
            }
        };

        const onWaiting = () => {
            this.isBuffering = true;
            if (this.client.isHost && !this.isSyncing) {
                this.client.sendPlayerEvent('buffering', video.currentTime, 'paused');
            }
        };

        const onCanPlay = () => {
            this.isBuffering = false;
            if (!this.client.isHost && this.client.isInRoom() && this.lastSyncServerTs) {
                const elapsed = this.lastSyncPlayState === 'playing' ?
                    Math.max(0, this.client.getServerNow() - this.lastSyncServerTs) / 1000 : 0;
                const expected = this.lastSyncPosition + elapsed;
                if (Math.abs(video.currentTime - expected) > 1.0) {
                    this.startSyncing(1000);
                    video.currentTime = expected;
                }
                if (this.lastSyncPlayState === 'playing' && video.paused) {
                    video.play().catch((err) => console.debug('[OWPPlayback] play prevented:', err));
                }
            }
        };

        const onPlaying = () => {
            this.isBuffering = false;
        };

        this.videoListeners = { onPlay, onPause, onSeeked, onWaiting, onCanPlay, onPlaying };

        video.addEventListener('play', onPlay);
        video.addEventListener('pause', onPause);
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('waiting', onWaiting);
        video.addEventListener('canplay', onCanPlay);
        video.addEventListener('playing', onPlaying);

        this.startIntervals();
    }

    unbindVideo() {
        if (this.video && this.videoListeners) {
            this.video.removeEventListener('play', this.videoListeners.onPlay);
            this.video.removeEventListener('pause', this.videoListeners.onPause);
            this.video.removeEventListener('seeked', this.videoListeners.onSeeked);
            this.video.removeEventListener('waiting', this.videoListeners.onWaiting);
            this.video.removeEventListener('canplay', this.videoListeners.onCanPlay);
            this.video.removeEventListener('playing', this.videoListeners.onPlaying);
        }
        this.video = null;
        this.videoListeners = null;
        this.stopIntervals();
    }

    startIntervals() {
        this.stopIntervals();

        this.hostStateTimer = setInterval(() => {
            const video = this.video || this.getVideo();
            if (this.client.isHost && this.client.isInRoom() && video && !this.isSyncing && !video.seeking) {
                this.client.sendStateUpdate(video.currentTime, video.paused ? 'paused' : 'playing');
            }
        }, STATE_UPDATE_INTERVAL_MS);

        this.syncLoopTimer = setInterval(() => {
            this.syncLoop();
        }, SYNC_LOOP_MS);
    }

    stopIntervals() {
        if (this.hostStateTimer) {
            clearInterval(this.hostStateTimer);
            this.hostStateTimer = null;
        }
        if (this.syncLoopTimer) {
            clearInterval(this.syncLoopTimer);
            this.syncLoopTimer = null;
        }
    }

    syncLoop() {
        const video = this.video || this.getVideo();
        if (!video) return;

        if (!this.client.isInRoom() || this.client.isHost || this.lastSyncPlayState !== 'playing' || !this.lastSyncServerTs || this.isBuffering || video.readyState < 3 || video.paused) {
            if (video.playbackRate !== 1) video.playbackRate = 1;
            return;
        }

        const elapsed = Math.max(0, this.client.getServerNow() - this.lastSyncServerTs) / 1000;
        const expected = this.lastSyncPosition + elapsed;
        const drift = expected - video.currentTime;
        const absDrift = Math.abs(drift);

        if (absDrift < DRIFT_DEADZONE_SEC) {
            if (video.playbackRate !== 1) video.playbackRate = 1;
            return;
        }

        if (absDrift >= DRIFT_SOFT_MAX_SEC) {
            this.startSyncing(1000);
            video.currentTime = expected;
            this.lastSyncPosition = expected;
            this.lastSyncServerTs = this.client.getServerNow();
            if (video.playbackRate !== 1) video.playbackRate = 1;
            return;
        }

        const correction = Math.sign(drift) * Math.sqrt(absDrift) * DRIFT_GAIN;
        video.playbackRate = Math.min(Math.max(1 + correction, PLAYBACK_RATE_MIN), PLAYBACK_RATE_MAX);
    }

    onRoomJoined(data) {
        this.bindCurrentVideo();

        if (!data.isHost && data.state) {
            this.lastSyncPosition = data.state.position || 0;
            this.lastSyncPlayState = data.state.play_state || 'paused';
            this.lastSyncServerTs = data.serverTs || this.client.getServerNow();

            const video = this.video || this.getVideo();
            if (video) {
                this.startSyncing(1500);
                const elapsed = this.lastSyncPlayState === 'playing' ?
                    Math.max(0, this.client.getServerNow() - this.lastSyncServerTs) / 1000 : 0;
                video.currentTime = this.lastSyncPosition + elapsed;
                if (this.lastSyncPlayState === 'playing') {
                    video.play().catch((err) => console.debug('[OWPPlayback] play prevented:', err));
                } else {
                    video.pause();
                }
            }
        }
    }

    onRoomLeft() {
        this.normalizePlaybackRate();
        this.lastSyncPosition = 0;
        this.lastSyncServerTs = 0;
        this.lastSyncPlayState = 'paused';
    }

    onPlayerEvent(payload, serverTs) {
        if (this.client.isHost || !payload) return;

        const video = this.video || this.getVideo();
        if (!video) return;

        this.startSyncing(2000);
        const position = typeof payload.position === 'number' ? payload.position : video.currentTime;

        switch (payload.action) {
            case 'play': {
                const elapsed = Math.max(0, this.client.getServerNow() - serverTs) / 1000;
                const target = position + elapsed;
                if (Math.abs(video.currentTime - target) > 1.0) {
                    video.currentTime = target;
                }
                this.lastSyncPosition = target;
                this.lastSyncServerTs = this.client.getServerNow();
                this.lastSyncPlayState = 'playing';

                const targetTs = payload.target_server_ts || serverTs;
                const delay = Math.max(0, targetTs - this.client.getServerNow());
                setTimeout(() => {
                    video.play().catch((err) => {
                        console.warn('[OWPPlayback] Autoplay blocked, click play to resume:', err);
                    });
                }, delay);
                break;
            }

            case 'pause': {
                video.currentTime = position;
                this.lastSyncPosition = position;
                this.lastSyncServerTs = this.client.getServerNow();
                this.lastSyncPlayState = 'paused';
                video.pause();
                this.normalizePlaybackRate();
                break;
            }

            case 'seek': {
                video.currentTime = position;
                this.lastSyncPosition = position;
                this.lastSyncServerTs = this.client.getServerNow();
                const hostPlaying = payload.play_state === 'playing';
                this.lastSyncPlayState = hostPlaying ? 'playing' : 'paused';
                if (hostPlaying) {
                    video.play().catch((err) => console.debug('[OWPPlayback] play prevented:', err));
                } else {
                    video.pause();
                    this.normalizePlaybackRate();
                }
                break;
            }

            case 'buffering': {
                video.currentTime = position;
                this.lastSyncPosition = position;
                this.lastSyncPlayState = 'paused';
                video.pause();
                break;
            }

            default:
                break;
        }
    }

    onStateUpdate(payload, serverTs) {
        if (this.client.isHost || !payload) return;

        const video = this.video || this.getVideo();
        if (!video) return;

        if (typeof payload.position === 'number') {
            this.lastSyncPosition = payload.position;
            this.lastSyncServerTs = serverTs || this.client.getServerNow();
        }

        if (payload.play_state) {
            this.lastSyncPlayState = payload.play_state;
            if (payload.play_state === 'playing' && video.paused && !this.isSyncing && !this.isBuffering) {
                video.play().catch((err) => console.debug('[OWPPlayback] play prevented:', err));
            } else if (payload.play_state === 'paused' && !video.paused && !this.isSyncing) {
                video.pause();
                this.normalizePlaybackRate();
            }
        }
    }
}

const owpPlayback = new OWPPlayback();
export default owpPlayback;
