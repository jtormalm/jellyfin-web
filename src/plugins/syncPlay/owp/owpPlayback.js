import { playbackManager } from '../../../components/playback/playbackmanager';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from '../../../utils/events';

const DRIFT_TRIGGER_SEC = 1.0;
const DRIFT_CLEAR_SEC = 0.4;
const DRIFT_HARD_SEEK_SEC = 5.0;
const PLAYBACK_RATE_MIN = 0.98;
const PLAYBACK_RATE_MAX = 1.02;
const RATE_HOLD_MS = 1000;
const SYNC_LOOP_MS = 500;
const STATE_UPDATE_INTERVAL_MS = 1000;
const HARD_SEEK_COOLDOWN_MS = 4000;
const NEUTRAL_DWELL_MS = 2000;

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
        this.lastHardSeekTime = 0;
        this.lastRateChangeTime = 0;
        this.isCorrectingRate = false;
        this.belowClearSince = null;

        this.lastBroadcastMediaId = null;
        this.currentMediaId = null;
        this.isLoadingMedia = null;
    }

    init(owpClient) {
        this.client = owpClient;

        this.client.on('room-joined', (data) => this.onRoomJoined(data));
        this.client.on('room-left', () => this.onRoomLeft());
        this.client.on('player-event', (payload, serverTs) => this.onPlayerEvent(payload, serverTs));
        this.client.on('state-update', (payload, serverTs) => this.onStateUpdate(payload, serverTs));
        this.client.on('change-media', (data) => this.onChangeMedia(data));
        this.client.on('participant-joined', () => this.onParticipantJoined());

        Events.on(playbackManager, 'playerchange', () => this.bindCurrentVideo());
        Events.on(playbackManager, 'playbackstart', (e, player) => this.onPlaybackStart(player));
        Events.on(playbackManager, 'playbackstop', () => {
            this.normalizePlaybackRate();
            this.unbindVideo();
            if (this.client?.isInRoom() && !this.isLoadingMedia) {
                console.info('[OWPPlayback] Exited playback -> leaving watch party');
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

        if ('preservesPitch' in video) {
            video.preservesPitch = false;
        } else if ('webkitPreservesPitch' in video) {
            video.webkitPreservesPitch = false;
        }

        const onPlay = () => {
            if (this.client.isHost) {
                this.broadcastHost('play');
            } else if (this.client.isInRoom() && !this.isSyncing) {
                if (this.lastSyncPlayState === 'paused' && !video.paused) {
                    video.pause();
                }
            }
        };

        const onPause = () => {
            if (this.client.isHost) {
                if (!this.isBuffering && !video.seeking) {
                    this.broadcastHost('pause');
                }
            } else if (this.client.isInRoom() && !this.isSyncing) {
                if (this.lastSyncPlayState === 'playing' && video.paused && !this.isBuffering) {
                    video.play().catch(() => { /* autoplay blocked */ });
                }
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
            } else if (!this.client.isHost && this.client.isInRoom() && !this.isSyncing && this.lastSyncServerTs) {
                const elapsed = this.lastSyncPlayState === 'playing' ?
                    Math.max(0, this.client.getServerNow() - this.lastSyncServerTs) / 1000 : 0;
                const expected = this.lastSyncPosition + elapsed;
                if (Math.abs(video.currentTime - expected) > 1.5) {
                    this.startSyncing(1000);
                    video.currentTime = expected;
                }
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
            if (video.playbackRate !== 1) {
                console.debug('[OWP-Sync] Resetting rate to 1.0 (idle/paused/buffering)');
                video.playbackRate = 1;
                this.isCorrectingRate = false;
                this.belowClearSince = null;
            }
            return;
        }

        const elapsed = Math.max(0, this.client.getServerNow() - this.lastSyncServerTs) / 1000;
        const expected = this.lastSyncPosition + elapsed;
        const drift = expected - video.currentTime;
        const absDrift = Math.abs(drift);
        const now = Date.now();

        // 1. Hard seek if drift is severe (>= 3.0s) and not in hard-seek cooldown
        if (absDrift >= DRIFT_HARD_SEEK_SEC) {
            if (now - this.lastHardSeekTime < HARD_SEEK_COOLDOWN_MS) {
                console.debug('[OWP-Sync] Severe drift but in hard-seek cooldown:', drift.toFixed(3), 's');
                return;
            }
            this.lastHardSeekTime = now;
            this.isCorrectingRate = false;
            this.belowClearSince = null;
            console.info('[OWP-Sync] Hard seek required. Drift:', drift.toFixed(3), 's. Target:', expected.toFixed(2), 'Actual:', video.currentTime.toFixed(2));
            this.startSyncing(1000);
            video.currentTime = expected;
            this.lastSyncPosition = expected;
            this.lastSyncServerTs = this.client.getServerNow();
            if (video.playbackRate !== 1) video.playbackRate = 1;
            return;
        }

        // 2. Hysteresis logic:
        // Only trigger rate correction if drift crosses DRIFT_TRIGGER_SEC.
        // Once active, keep ping-ponging directly between the two catch-up
        // rates (skipping 1.0x) as long as drift stays outside the clear
        // band, so a sign flip costs one rate change instead of two. Only
        // settle back to 1.0x once drift has stayed inside the clear band
        // for NEUTRAL_DWELL_MS, to avoid immediately re-triggering.
        if (!this.isCorrectingRate && absDrift >= DRIFT_TRIGGER_SEC) {
            this.isCorrectingRate = true;
            this.belowClearSince = null;
            console.info('[OWP-Sync] Drift crossed threshold (', drift.toFixed(3), 's) -> activating subtle rate correction');
        } else if (this.isCorrectingRate) {
            if (absDrift < DRIFT_CLEAR_SEC) {
                if (!this.belowClearSince) this.belowClearSince = now;
                if (now - this.belowClearSince >= NEUTRAL_DWELL_MS) {
                    this.isCorrectingRate = false;
                    this.belowClearSince = null;
                    console.info('[OWP-Sync] Drift settled (', drift.toFixed(3), 's) -> returning to 1.0x');
                }
            } else {
                this.belowClearSince = null;
            }
        }

        // 3. Normal playback (rate = 1.0)
        if (!this.isCorrectingRate) {
            if (video.playbackRate !== 1 && now - this.lastRateChangeTime >= RATE_HOLD_MS) {
                video.playbackRate = 1;
                this.lastRateChangeTime = now;
            }
            return;
        }

        // 4. Subtle catch-up rate, ping-ponging directly between the two
        // rates based on drift sign (held for at least RATE_HOLD_MS)
        if (now - this.lastRateChangeTime >= RATE_HOLD_MS) {
            const targetRate = drift > 0 ? PLAYBACK_RATE_MAX : PLAYBACK_RATE_MIN;
            if (video.playbackRate !== targetRate) {
                console.debug('[OWP-Sync] Applying held catch-up rate:', targetRate, 'drift:', drift.toFixed(3), 's');
                video.playbackRate = targetRate;
                this.lastRateChangeTime = now;
            }
        }
    }

    onRoomJoined(data) {
        this.bindCurrentVideo();

        if (!data.isHost) {
            this.currentMediaId = data.mediaId || null;
            if (data.mediaId) {
                this.loadAndPlayMedia(data.mediaId, data.state?.position || 0, data.state?.play_state || 'playing');
            } else if (data.state) {
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
        } else {
            const currentPlayer = playbackManager.getCurrentPlayer();
            const currentItem = currentPlayer ? playbackManager.currentItem(currentPlayer) : null;
            if (currentItem?.Id) {
                this.lastBroadcastMediaId = currentItem.Id;
                this.currentMediaId = currentItem.Id;
            }
        }
    }

    onRoomLeft() {
        this.normalizePlaybackRate();
        this.lastSyncPosition = 0;
        this.lastSyncServerTs = 0;
        this.lastSyncPlayState = 'paused';
        this.lastBroadcastMediaId = null;
        this.currentMediaId = null;
        this.isLoadingMedia = null;
    }

    onPlaybackStart(player) {
        this.bindCurrentVideo();
        if (this.client?.isHost && this.client?.isInRoom()) {
            const currentPlayer = player || playbackManager.getCurrentPlayer();
            const currentItem = currentPlayer ? playbackManager.currentItem(currentPlayer) : null;
            if (currentItem?.Id && currentItem.Id !== this.lastBroadcastMediaId) {
                this.lastBroadcastMediaId = currentItem.Id;
                this.currentMediaId = currentItem.Id;
                const video = this.video || this.getVideo();
                const startPos = (video && !Number.isNaN(video.currentTime)) ? video.currentTime : 0;
                console.info('[OWPPlayback] Host started media, broadcasting change_media:', currentItem.Id, 'pos:', startPos);
                this.client.sendMediaChange(currentItem.Id, startPos);
            }
        } else if (!this.client?.isHost && this.client?.isInRoom()) {
            const currentPlayer = player || playbackManager.getCurrentPlayer();
            const currentItem = currentPlayer ? playbackManager.currentItem(currentPlayer) : null;
            if (currentItem?.Id && this.currentMediaId && currentItem.Id !== this.currentMediaId && !this.isLoadingMedia) {
                console.info('[OWPPlayback] Participant started different media:', currentItem.Id, 'expected:', this.currentMediaId, '-> leaving watch party');
                this.client.leaveRoom();
            }
        }
    }

    onParticipantJoined() {
        if (this.client?.isHost && this.client?.isInRoom()) {
            const currentPlayer = playbackManager.getCurrentPlayer();
            const currentItem = currentPlayer ? playbackManager.currentItem(currentPlayer) : null;
            const video = this.video || this.getVideo();
            if (currentItem?.Id) {
                const pos = (video && !Number.isNaN(video.currentTime)) ? video.currentTime : 0;
                console.info('[OWPPlayback] Participant joined, broadcasting current media:', currentItem.Id, 'pos:', pos);
                this.client.sendMediaChange(currentItem.Id, pos);
            }
        }
    }

    onChangeMedia(data) {
        if (this.client?.isHost || !data.media_id) return;
        this.currentMediaId = data.media_id;
        console.info('[OWPPlayback] Host changed media:', data.media_id, 'pos:', data.start_pos);
        this.loadAndPlayMedia(data.media_id, data.start_pos || 0, 'playing');
    }

    async loadAndPlayMedia(mediaId, position = 0, playState = 'playing') {
        if (!mediaId) return;

        const currentPlayer = playbackManager.getCurrentPlayer();
        let currentItem = null;
        if (currentPlayer) {
            try {
                currentItem = playbackManager.currentItem(currentPlayer);
            } catch {
                currentItem = null;
            }
        }

        if (currentItem?.Id === mediaId) {
            console.info('[OWPPlayback] Already playing media:', mediaId);
            const video = this.video || this.getVideo();
            if (video && typeof position === 'number') {
                if (Math.abs(video.currentTime - position) > 1.0) {
                    video.currentTime = position;
                }
                if (playState === 'playing' && video.paused) {
                    video.play().catch(() => { /* autoplay blocked */ });
                } else if (playState === 'paused' && !video.paused) {
                    video.pause();
                }
            }
            return;
        }

        if (this.isLoadingMedia === mediaId) return;
        this.isLoadingMedia = mediaId;

        try {
            console.info('[OWPPlayback] Auto-loading watch party media:', mediaId);
            const apiClient = ServerConnections.currentApiClient();
            const userId = apiClient.getCurrentUserId?.() || apiClient._currentUserId;
            const item = await apiClient.getItem(userId, mediaId);
            if (!item) return;

            this.startSyncing(3000);
            this.lastSyncPosition = position;
            this.lastSyncServerTs = this.client.getServerNow();
            this.lastSyncPlayState = playState;
            this.currentMediaId = mediaId;

            const startPositionTicks = Math.floor(Math.max(0, position) * 10000000);
            await playbackManager.play({
                items: [item],
                startPositionTicks
            });

            if (playState === 'paused') {
                setTimeout(() => {
                    const v = this.video || this.getVideo();
                    if (v) v.pause();
                }, 600);
            }
        } catch (err) {
            console.error('[OWPPlayback] Error loading watch party media:', err);
        } finally {
            this.isLoadingMedia = null;
        }
    }

    onPlayerEvent(payload, serverTs) {
        if (this.client.isHost || !payload) return;

        const video = this.video || this.getVideo();
        if (!video) return;

        console.info('[OWP-Sync] Received host player_event:', payload.action, 'pos:', payload.position, 'play_state:', payload.play_state);
        this.startSyncing(2000);
        const position = typeof payload.position === 'number' ? payload.position : video.currentTime;

        switch (payload.action) {
            case 'play': {
                const elapsed = Math.max(0, this.client.getServerNow() - serverTs) / 1000;
                const target = position + elapsed;
                if (Math.abs(video.currentTime - target) > 1.0) {
                    console.info('[OWP-Sync] Aligning position on play:', video.currentTime.toFixed(2), '->', target.toFixed(2));
                    video.currentTime = target;
                }
                this.lastSyncPosition = target;
                this.lastSyncServerTs = this.client.getServerNow();
                this.lastSyncPlayState = 'playing';

                const targetTs = payload.target_server_ts || serverTs;
                const delay = Math.max(0, targetTs - this.client.getServerNow());
                setTimeout(() => {
                    video.play().catch((err) => {
                        console.warn('[OWP-Sync] Autoplay blocked, click play to resume:', err);
                    });
                }, delay);
                break;
            }

            case 'pause': {
                console.info('[OWP-Sync] Pausing playback at:', position.toFixed(2));
                video.currentTime = position;
                this.lastSyncPosition = position;
                this.lastSyncServerTs = this.client.getServerNow();
                this.lastSyncPlayState = 'paused';
                video.pause();
                this.normalizePlaybackRate();
                break;
            }

            case 'seek': {
                console.info('[OWP-Sync] Seeking to:', position.toFixed(2));
                video.currentTime = position;
                this.lastSyncPosition = position;
                this.lastSyncServerTs = this.client.getServerNow();
                const hostPlaying = payload.play_state === 'playing';
                this.lastSyncPlayState = hostPlaying ? 'playing' : 'paused';
                if (hostPlaying) {
                    video.play().catch((err) => console.debug('[OWP-Sync] play prevented:', err));
                } else {
                    video.pause();
                    this.normalizePlaybackRate();
                }
                break;
            }

            case 'buffering': {
                console.info('[OWP-Sync] Host buffering at:', position.toFixed(2));
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
                console.info('[OWP-Sync] Resuming playback from state update');
                video.play().catch((err) => console.debug('[OWP-Sync] play prevented:', err));
            } else if (payload.play_state === 'paused' && !video.paused && !this.isSyncing) {
                console.info('[OWP-Sync] Pausing playback from state update');
                video.pause();
                this.normalizePlaybackRate();
            }
        }
    }
}

const owpPlayback = new OWPPlayback();
export default owpPlayback;
