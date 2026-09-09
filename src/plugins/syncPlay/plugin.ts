import { playbackManager } from '../../components/playback/playbackmanager';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from '../../utils/events';
import SyncPlay from './core';
import SyncPlayNoActivePlayer from './ui/players/NoActivePlayer';
import SyncPlayHtmlVideoPlayer from './ui/players/HtmlVideoPlayer';
import SyncPlayHtmlAudioPlayer from './ui/players/HtmlAudioPlayer';
import { Plugin, PluginType } from '../../types/plugin';
import owpClient from './owp/owpClient';
import owpPlayback from './owp/owpPlayback';

class SyncPlayPlugin implements Plugin {
    name: string;
    id: string;
    type: string;
    priority: number;
    instance: typeof SyncPlay;

    constructor() {
        this.name = 'SyncPlay Plugin';
        this.id = 'syncplay';
        // NOTE: This should probably be a "mediaplayer" so the playback manager can handle playback logic, but
        // SyncPlay needs refactored so it does not have an independent playback manager.
        this.type = PluginType.SyncPlay;
        this.priority = 1;

        this.instance = SyncPlay;

        this.init();
    }

    init() {
        // Register player wrappers.
        SyncPlay.PlayerFactory.setDefaultWrapper(SyncPlayNoActivePlayer);
        SyncPlay.PlayerFactory.registerWrapper(SyncPlayHtmlVideoPlayer);
        SyncPlay.PlayerFactory.registerWrapper(SyncPlayHtmlAudioPlayer);

        // Listen for player changes.
        Events.on(playbackManager, 'playerchange', (_, newPlayer) => {
            SyncPlay.Manager.onPlayerChange(newPlayer);
        });

        // Initialize OpenWatchParty syncing
        owpPlayback.init(owpClient);

        // Start SyncPlay.
        const apiClient = ServerConnections.currentApiClient();
        if (apiClient) {
            SyncPlay.Manager.init(apiClient);
            owpClient.init(apiClient);
        }

        // NOTE: Multiple apiClients?
        Events.on(ServerConnections, 'apiclientcreated', (_, newApiClient) => {
            SyncPlay.Manager.init(newApiClient);
            owpClient.init(newApiClient);
        });
        Events.on(ServerConnections, 'localusersignedin', () => {
            const client = ServerConnections.currentApiClient();
            SyncPlay.Manager.updateApiClient(client);
            owpClient.updateApiClient(client);
        });
        Events.on(ServerConnections, 'localusersignedout', () => {
            const client = ServerConnections.currentApiClient();
            SyncPlay.Manager.updateApiClient(client);
            owpClient.disconnect();
        });
    }
}

export default SyncPlayPlugin;
