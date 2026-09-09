import toast from '../../../components/toast/toast';
import globalize from '../../../lib/globalize';

const DEFAULT_WS_URL = 'wss://party.jellyfin.nu/ws';
const PING_INTERVAL_MS = 10000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

class OWPClient {
    constructor() {
        this.apiClient = null;
        this.ws = null;
        this.wsUrl = DEFAULT_WS_URL;
        this.tokenRefreshTimer = null;

        this.userId = '';
        this.userName = '';
        this.clientId = '';

        this.roomId = '';
        this.roomName = '';
        this.isHost = false;
        this.inRoom = false;
        this.participantCount = 0;
        this.rooms = [];

        this.serverOffsetMs = 0;
        this.isAuthenticated = false;
        this.autoReconnect = true;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.pingTimer = null;
        this.connectPromise = null;

        this.listeners = new Map();
    }

    on(event, callback) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    once(event, callback) {
        const handler = (...args) => {
            this.off(event, handler);
            callback(...args);
        };
        return this.on(event, handler);
    }

    off(event, callback) {
        this.listeners.get(event)?.delete(callback);
    }

    emit(event, ...args) {
        for (const callback of this.listeners.get(event) || []) {
            try {
                callback(...args);
            } catch (err) {
                console.error(`[OWPClient] Error in ${event} listener:`, err);
            }
        }
    }

    nowMs() {
        return Date.now();
    }

    getServerNow() {
        return this.nowMs() + (this.serverOffsetMs || 0);
    }

    isInRoom() {
        return this.inRoom && Boolean(this.roomId);
    }

    getRoomName() {
        return this.roomName || 'Watch Party';
    }

    getParticipantCount() {
        return this.participantCount || 1;
    }

    init(apiClient) {
        if (!apiClient) return;
        this.apiClient = apiClient;
        const accessToken = typeof apiClient.accessToken === 'function' ?
            apiClient.accessToken() : apiClient._accessToken;
        if (!accessToken) return;

        this.userId = apiClient.getCurrentUserId?.() || apiClient._currentUserId || '';
        this.userName = apiClient._currentUser?.Name || apiClient.currentUser?.()?.Name || 'User';
        this.connect();
    }

    updateApiClient(apiClient) {
        if (!apiClient) return;
        this.apiClient = apiClient;
        const newUserId = apiClient.getCurrentUserId?.() || apiClient._currentUserId || '';
        const newUserName = apiClient._currentUser?.Name || apiClient.currentUser?.()?.Name || 'User';
        const accessToken = typeof apiClient.accessToken === 'function' ?
            apiClient.accessToken() : apiClient._accessToken;

        if (!accessToken) {
            this.disconnect();
            return;
        }

        const userChanged = Boolean(this.userId && this.userId !== newUserId);
        this.userId = newUserId;
        this.userName = newUserName;

        if (userChanged || !this.isAuthenticated || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.disconnect();
            this.connect();
        }
    }

    async fetchAuthToken() {
        if (!this.apiClient) return null;
        const accessToken = typeof this.apiClient.accessToken === 'function' ?
            this.apiClient.accessToken() : this.apiClient._accessToken;
        if (!accessToken) return null;

        const tokenUrl = typeof this.apiClient.getUrl === 'function' ?
            this.apiClient.getUrl('OpenWatchParty/Token') :
            `${this.apiClient.serverAddress?.() || ''}/OpenWatchParty/Token`;

        try {
            const response = await fetch(tokenUrl, {
                headers: { 'X-Emby-Token': accessToken }
            });
            if (!response.ok) return null;

            const data = await response.json();
            if (data.session_server_url) {
                let url = data.session_server_url;
                if (window.location.protocol === 'https:' && url.startsWith('ws:')) {
                    url = url.replace(/^ws:/, 'wss:');
                }
                this.wsUrl = url;
            }

            this.userId = data.user_id || this.userId;
            this.userName = data.user_name || this.userName;

            this.scheduleTokenRefresh(data.expires_in || 3600);

            return {
                token: data.token || null,
                wsUrl: this.wsUrl
            };
        } catch (err) {
            console.warn('[OWPClient] Failed to fetch auth token:', err);
            return null;
        }
    }

    scheduleTokenRefresh(expiresInSec) {
        if (this.tokenRefreshTimer) {
            clearTimeout(this.tokenRefreshTimer);
            this.tokenRefreshTimer = null;
        }

        const refreshInMs = Math.max(10000, (expiresInSec * 1000) - 60000);
        this.tokenRefreshTimer = setTimeout(async () => {
            const auth = await this.fetchAuthToken();
            if (auth?.token && this.ws?.readyState === WebSocket.OPEN) {
                this.send('auth', {
                    token: auth.token,
                    ['user_name']: this.userName,
                    ['user_id']: this.userId
                });
            }
        }, refreshInMs);
    }

    async connect() {
        if (this.isAuthenticated && this.ws?.readyState === WebSocket.OPEN) return true;
        if (this.connectPromise) return this.connectPromise;

        this.connectPromise = new Promise((resolve) => {
            this.autoReconnect = true;
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            this.fetchAuthToken().then((auth) => {
                if (!auth?.token) {
                    this.connectPromise = null;
                    resolve(false);
                    return;
                }

                const wsUrl = auth.wsUrl || this.wsUrl || DEFAULT_WS_URL;
                console.log('[OWPClient] Connecting to watch party server:', wsUrl);

                try {
                    this.ws = new WebSocket(wsUrl);
                } catch (err) {
                    console.error('[OWPClient] WebSocket init failed:', err);
                    this.scheduleReconnect();
                    this.connectPromise = null;
                    resolve(false);
                    return;
                }

                const socket = this.ws;
                let settled = false;
                const done = (success) => {
                    if (!settled) {
                        settled = true;
                        this.connectPromise = null;
                        resolve(success);
                    }
                };

                socket.onopen = () => {
                    if (socket !== this.ws) return;
                    this.reconnectAttempts = 0;
                    this.send('auth', {
                        token: auth.token,
                        ['user_name']: this.userName,
                        ['user_id']: this.userId
                    });
                    this.send('ping', { ['client_ts']: this.nowMs() });
                    this.startPingInterval();
                };

                this.once('auth-success', () => done(true));

                socket.onerror = () => done(false);

                socket.onclose = (event) => {
                    if (socket !== this.ws) return;
                    console.log('[OWPClient] WebSocket closed:', event.code, event.reason);
                    this.isAuthenticated = false;
                    this.ws = null;
                    this.stopPingInterval();
                    if (this.inRoom) this.resetRoomState();
                    if (this.autoReconnect) this.scheduleReconnect();
                    done(false);
                };

                socket.onmessage = (e) => {
                    if (socket !== this.ws) return;
                    try {
                        this.handleMessage(JSON.parse(e.data));
                    } catch {
                        // ignore invalid JSON
                    }
                };

                setTimeout(() => done(this.isAuthenticated), 5000);
            }).catch(() => {
                this.connectPromise = null;
                resolve(false);
            });
        });

        return this.connectPromise;
    }

    scheduleReconnect() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        const delay = Math.min(
            RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
            RECONNECT_MAX_MS
        );
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.autoReconnect) this.connect();
        }, delay);
    }

    disconnect() {
        this.autoReconnect = false;
        this.isAuthenticated = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.tokenRefreshTimer) {
            clearTimeout(this.tokenRefreshTimer);
            this.tokenRefreshTimer = null;
        }
        this.stopPingInterval();

        if (this.inRoom) this.leaveRoom();

        if (this.ws) {
            const socket = this.ws;
            this.ws = null;
            socket.close(1000, 'Client disconnected');
        }
    }

    startPingInterval() {
        this.stopPingInterval();
        this.pingTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.send('ping', { ['client_ts']: this.nowMs() });
            }
        }, PING_INTERVAL_MS);
    }

    stopPingInterval() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }

    send(type, payload = {}, roomOverride = null) {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        const message = {
            type,
            payload,
            ts: this.nowMs()
        };
        const room = roomOverride || this.roomId;
        if (room) message.room = room;
        if (this.clientId) message.client = this.clientId;

        this.ws.send(JSON.stringify(message));
    }

    async fetchRooms() {
        if (!this.isAuthenticated || this.ws?.readyState !== WebSocket.OPEN) {
            const ok = await this.connect();
            if (!ok) return this.rooms || [];
        }

        return new Promise((resolve) => {
            const onRoomList = (rooms) => {
                clearTimeout(timer);
                resolve(rooms);
            };
            const timer = setTimeout(() => {
                this.off('room-list', onRoomList);
                resolve(this.rooms || []);
            }, 2000);

            this.once('room-list', onRoomList);
            this.send('list_rooms');
        });
    }

    handleMessage(msg) {
        switch (msg.type) {
            case 'client_hello':
                if (msg.payload?.client_id) this.clientId = msg.payload.client_id;
                break;

            case 'auth_success':
                this.isAuthenticated = true;
                this.emit('auth-success');
                this.send('list_rooms');
                break;

            case 'room_list':
                this.rooms = Array.isArray(msg.payload) ? msg.payload : [];
                this.emit('room-list', this.rooms);
                break;

            case 'room_state': {
                const wasInRoom = this.inRoom;
                this.inRoom = true;
                this.roomId = msg.room || '';
                const rawName = msg.payload?.name || 'Watch Party';
                const match = rawName.match(/^Room de (.+)$/);
                this.roomName = match ?
                    globalize.translate('SyncPlayGroupDefaultTitle', match[1]) :
                    rawName;
                this.participantCount = msg.payload?.participant_count || 1;
                if (!this.clientId && msg.client) this.clientId = msg.client;
                this.isHost = (msg.payload?.host_id === this.clientId);

                if (typeof msg.server_ts === 'number') {
                    this.serverOffsetMs = msg.server_ts - this.nowMs();
                }

                if (!wasInRoom) {
                    toast({ text: globalize.translate('MessageSyncPlayEnabled') || 'Joined Watch Party' });
                }

                this.emit('room-joined', {
                    roomId: this.roomId,
                    roomName: this.roomName,
                    isHost: this.isHost,
                    participantCount: this.participantCount,
                    mediaId: msg.payload?.media_id || null,
                    state: msg.payload?.state || null,
                    targetServerTs: msg.payload?.target_server_ts || null,
                    serverTs: msg.server_ts || this.getServerNow()
                });
                this.emit('status-change', true);
                break;
            }

            case 'participants_update':
            case 'client_left':
                if (typeof msg.payload?.participant_count === 'number') {
                    const prevCount = this.participantCount;
                    this.participantCount = msg.payload.participant_count;
                    if (this.participantCount > prevCount) {
                        toast({ text: 'A participant joined the watch party' });
                    } else if (msg.type === 'client_left') {
                        toast({ text: 'A participant left the watch party' });
                    }
                    this.emit('participants-update', this.participantCount);
                }
                break;

            case 'room_closed':
                toast({ text: msg.payload?.reason || 'The watch party was closed' });
                this.resetRoomState();
                break;

            case 'player_event':
            case 'state_update':
                this.emit(msg.type.replace('_', '-'), msg.payload, msg.server_ts || this.getServerNow());
                break;

            case 'pong':
                if (msg.payload?.client_ts && typeof msg.server_ts === 'number') {
                    const rtt = this.nowMs() - msg.payload.client_ts;
                    if (rtt > 0) {
                        const sampleOffset = msg.server_ts + (rtt / 2) - this.nowMs();
                        this.serverOffsetMs = this.serverOffsetMs ?
                            (this.serverOffsetMs * 0.7 + sampleOffset * 0.3) :
                            sampleOffset;
                    }
                }
                break;

            default:
                break;
        }
    }

    createRoom(mediaId = null, startPos = 0) {
        if (this.ws?.readyState !== WebSocket.OPEN) {
            toast({ text: 'Not connected to watch party server' });
            this.connect();
            return;
        }
        this.send('create_room', {
            ['start_pos']: typeof startPos === 'number' ? startPos : 0,
            ['media_id']: mediaId || null,
            ['user_name']: this.userName || 'User'
        });
    }

    joinRoom(roomId) {
        if (!roomId) return;
        if (this.ws?.readyState !== WebSocket.OPEN) {
            toast({ text: 'Not connected to watch party server' });
            this.connect();
            return;
        }
        this.send('join_room', { ['user_name']: this.userName || 'User' }, roomId);
    }

    leaveRoom() {
        if (!this.inRoom && !this.roomId) return;
        this.send('leave_room');
        this.resetRoomState();
        toast({ text: globalize.translate('MessageSyncPlayDisabled') || 'Left watch party' });
    }

    resetRoomState() {
        const prevRoomId = this.roomId;
        this.inRoom = false;
        this.roomId = '';
        this.roomName = '';
        this.isHost = false;
        this.participantCount = 0;

        this.emit('room-left', { roomId: prevRoomId });
        this.emit('status-change', false);
    }

    sendPlayerEvent(action, position, playState) {
        if (!this.isHost || !this.inRoom) return;
        this.send('player_event', { action, position, ['play_state']: playState });
    }

    sendStateUpdate(position, playState) {
        if (!this.isHost || !this.inRoom) return;
        this.send('state_update', { position, ['play_state']: playState });
    }
}

const owpClient = new OWPClient();
export default owpClient;
