import { PluginType } from 'constants/pluginType';
import { ServerConnections } from 'lib/jellyfin-apiclient';

import SyncPlaySettingsEditor from './settings/SettingsEditor';
import { playbackManager } from '../../../components/playback/playbackmanager';
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
        const count = owpClient.getParticipantCount() || 1;
        for (const btn of buttons) {
            let badge = btn.querySelector('.syncButton-badge');
            if (inRoom) {
                btn.classList.add('syncButton-active');
                btn.title = globalize.translate('ButtonSyncPlay');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'syncButton-badge';
                    btn.appendChild(badge);
                }
                badge.textContent = String(count);
                badge.style.display = 'flex';
            } else {
                btn.classList.remove('syncButton-active');
                btn.title = globalize.translate('ButtonSyncPlay');
                if (badge) {
                    badge.remove();
                }
            }
        }
    }

    async showLeaveGroupSelection(button) {
        const count = owpClient.getParticipantCount();
        try {
            const id = await actionsheet.show({
                title: globalize.translate('ButtonSyncPlay'),
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
        const canCreate = Boolean(video && currentItem?.Id);

        try {
            const apiClient = ServerConnections.currentApiClient();
            const user = await ServerConnections.user(apiClient);
            const policy = user?.localUser?.Policy || user?.Policy || {};
            const allRooms = await owpClient.fetchRooms();
            const userId = apiClient.getCurrentUserId?.() || apiClient._currentUserId;

            const mediaTitles = await Promise.all(allRooms.map(async (room) => {
                if (!room.media_id) return null;
                try {
                    const item = await apiClient.getItem(userId, room.media_id);
                    return item?.SeriesName ? `${item.SeriesName} - ${item.Name}` : item?.Name || null;
                } catch {
                    return null;
                }
            }));

            const menuItems = allRooms.map((room, index) => {
                const count = room.count || 1;
                const rawName = room.name || 'Watch Party';
                const match = rawName.match(/^Room de (.+)$/);
                const baseName = match ?
                    globalize.translate('SyncPlayGroupDefaultTitle', match[1]) :
                    rawName;
                const mediaTitle = mediaTitles[index];

                return {
                    name: `${baseName} (${count})`,
                    icon: 'groups',
                    id: room.id,
                    selected: false,
                    secondaryText: mediaTitle || undefined
                };
            });

            if (canCreate && policy.SyncPlayAccess !== 'JoinGroups') {
                menuItems.push({
                    name: globalize.translate('LabelSyncPlayNewGroup'),
                    icon: 'add',
                    id: 'new-group',
                    selected: menuItems.length === 0,
                    secondaryText: globalize.translate('LabelSyncPlayNewGroupDescription')
                });
            }

            if (menuItems.length === 0) {
                menuItems.push({
                    name: 'No watch parties available',
                    icon: 'info',
                    id: 'no-groups',
                    selected: false,
                    secondaryText: canCreate ?
                        globalize.translate('MessageSyncPlayCreateGroupDenied') :
                        'Start playing a video to create one'
                });
            }

            const id = await actionsheet.show({
                title: globalize.translate('HeaderSyncPlaySelectGroup'),
                items: menuItems,
                positionTo: button,
                border: true,
                dialogClass: 'syncPlayGroupMenu'
            });

            if (id === 'new-group') {
                const startPos = !Number.isNaN(video.currentTime) ? video.currentTime : 0;
                owpClient.createRoom(currentItem.Id, startPos);
            } else if (id && id !== 'no-groups') {
                owpClient.joinRoom(id);
            }
        } catch (error) {
            if (error?.message !== 'ActionSheet closed without resolving') {
                console.error('WatchParty: error in group menu:', error);
                toast({ text: globalize.translate('MessageSyncPlayNoGroupsAvailable') });
            }
        }
    }
}

const groupSelectionMenu = new GroupSelectionMenu();
export default groupSelectionMenu;
