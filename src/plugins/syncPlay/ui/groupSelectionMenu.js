import { PluginType } from 'constants/pluginType';
import { ServerConnections } from 'lib/jellyfin-apiclient';

import SyncPlaySettingsEditor from './settings/SettingsEditor';
import { playbackManager } from '../../../components/playback/playbackmanager';
import loading from '../../../components/loading/loading';
import toast from '../../../components/toast/toast';
import actionsheet from '../../../components/actionSheet/actionSheet';
import globalize from '../../../lib/globalize';
import playbackPermissionManager from './playbackPermissionManager';
import { pluginManager } from '../../../components/pluginManager';
import Events from '../../../utils/events.ts';
import owpClient from '../owp/owpClient';

import './groupSelectionMenu.scss';

/**
 * Manages the Watch Party group selection and leave menus.
 */
class GroupSelectionMenu {
    constructor() {
        this.syncPlayEnabled = false;

        owpClient.on('status-change', (inRoom) => {
            this.syncPlayEnabled = inRoom;
            this.updateButtonVisuals(inRoom);
        });

        owpClient.on('participants-update', () => {
            if (this.syncPlayEnabled) {
                this.updateButtonVisuals(true);
            }
        });
    }

    updateButtonVisuals(inRoom) {
        const buttons = document.querySelectorAll('.headerSyncButton');
        for (const btn of buttons) {
            if (inRoom) {
                btn.classList.add('syncButton-active');
                btn.title = owpClient.getRoomName();
            } else {
                btn.classList.remove('syncButton-active');
                btn.title = globalize.translate('ButtonSyncPlay');
            }
        }
    }

    async showLeaveGroupSelection(button) {
        const count = owpClient.getParticipantCount();
        try {
            const id = await actionsheet.show({
                title: owpClient.getRoomName(),
                text: `${count} participant${count === 1 ? '' : 's'}`,
                dialogClass: 'syncPlayGroupMenu',
                items: [
                    {
                        name: globalize.translate('LabelSyncPlayLeaveGroup'),
                        icon: 'meeting_room',
                        id: 'leave-group',
                        selected: true,
                        secondaryText: globalize.translate('LabelSyncPlayLeaveGroupDescription')
                    }
                ],
                positionTo: button,
                border: true
            });

            if (id === 'leave-group') {
                owpClient.leaveRoom();
            }
        } catch (error) {
            if (error?.message !== 'ActionSheet closed without resolving') {
                console.error('WatchParty: error showing leave menu:', error);
            }
        }
    }

    async show(button) {
        if (owpClient.isInRoom()) {
            await this.showLeaveGroupSelection(button);
            return;
        }

        const currentPlayer = playbackManager.getCurrentPlayer();
        let currentItem = null;
        if (currentPlayer) {
            try {
                currentItem = playbackManager.currentItem(currentPlayer);
            } catch {
                currentItem = null;
            }
        }
        const video = document.querySelector('video');

        if (!video || !currentItem?.Id) {
            toast({
                text: 'Start playing a video first to start or join a Watch Party'
            });
            return;
        }

        loading.show();

        try {
            const apiClient = ServerConnections.currentApiClient();
            const user = await ServerConnections.user(apiClient);
            const policy = user?.localUser?.Policy || user?.Policy || {};
            const allRooms = await owpClient.fetchRooms();
            const matchingRooms = allRooms.filter((r) => r.media_id === currentItem.Id);

            const menuItems = matchingRooms.map((room) => {
                const count = room.count || 1;
                return {
                    name: room.name || 'Watch Party',
                    icon: 'groups',
                    id: room.id,
                    selected: false,
                    secondaryText: `${count} participant${count === 1 ? '' : 's'}`
                };
            });

            if (policy.SyncPlayAccess !== 'JoinGroups') {
                menuItems.push({
                    name: globalize.translate('LabelSyncPlayNewGroup'),
                    icon: 'add',
                    id: 'new-group',
                    selected: menuItems.length === 0,
                    secondaryText: globalize.translate('LabelSyncPlayNewGroupDescription')
                });
            }

            if (menuItems.length === 0) {
                toast({ text: globalize.translate('MessageSyncPlayCreateGroupDenied') });
                return;
            }

            const id = await actionsheet.show({
                title: currentItem.Name ? `Watch Party - ${currentItem.Name}` : globalize.translate('HeaderSyncPlaySelectGroup'),
                items: menuItems,
                positionTo: button,
                border: true,
                dialogClass: 'syncPlayGroupMenu'
            });

            if (id === 'new-group') {
                const startPos = !Number.isNaN(video.currentTime) ? video.currentTime : 0;
                owpClient.createRoom(currentItem.Id, startPos);
            } else if (id) {
                owpClient.joinRoom(id);
            }
        } catch (error) {
            if (error?.message !== 'ActionSheet closed without resolving') {
                console.error('WatchParty: error in group menu:', error);
                toast({ text: globalize.translate('MessageSyncPlayNoGroupsAvailable') });
            }
        } finally {
            loading.hide();
        }
    }
}

const groupSelectionMenu = new GroupSelectionMenu();
export default groupSelectionMenu;
