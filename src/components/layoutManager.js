import { LayoutMode, LegacyLayoutModes } from 'constants/layoutMode';

import { appHost } from './apphost';
import browser from '../scripts/browser';
import appSettings from '../scripts/settings/appSettings';
import Events from '../utils/events.ts';

function setLayout(instance, layout, selectedLayout) {
    if (layout === selectedLayout) {
        instance[layout] = true;
        document.documentElement.classList.add('layout-' + layout);
    } else {
        instance[layout] = false;
        document.documentElement.classList.remove('layout-' + layout);
    }
}

export const SETTING_KEY = 'layout';

class LayoutManager {
    tv = false;
    mobile = false;
    desktop = false;
    modern = false;

    setLayout(layout = '', save = true) {
        const layoutValue = (!layout || layout === LayoutMode.Auto) ? '' : layout;
        const isLegacyLayout = LegacyLayoutModes.has(layoutValue);
        // Normalize layout mode to the base mode (e.g. 'mobile-legacy' -> 'mobile')
        const normalizedLayout = layoutValue.split('-')[0];

        if (!layoutValue) {
            this.autoLayout();
        } else {
            setLayout(this, LayoutMode.Mobile, normalizedLayout);
            setLayout(this, LayoutMode.Tv, normalizedLayout);
            setLayout(this, LayoutMode.Desktop, normalizedLayout);
        }

        console.debug('[LayoutManager] using layout mode', normalizedLayout);
        this.modern = !isLegacyLayout;
        if (layoutValue === LayoutMode.Modern) {
            const legacyLayoutMode = browser.mobile ? LayoutMode.Mobile : LayoutMode.Desktop;
            console.debug('[LayoutManager] using legacy layout mode', legacyLayoutMode);
            setLayout(this, legacyLayoutMode, legacyLayoutMode);
        }

        if (save) appSettings.set(SETTING_KEY, layoutValue);

        Events.trigger(this, 'modechange');
    }

    getSavedLayout() {
        const saved = appSettings.get(SETTING_KEY);
        // Validate that the saved layout is a supported legacy layout mode
        if (saved && LegacyLayoutModes.has(saved)) {
            return saved;
        }
    }

    autoLayout() {
        if (browser.tv) {
            this.setLayout(LayoutMode.Tv, false);
        } else if (browser.mobile) {
            this.setLayout(LayoutMode.MobileLegacy, false);
        } else {
            this.setLayout(LayoutMode.DesktopLegacy, false);
        }
    }

    init() {
        const saved = this.getSavedLayout();
        if (saved) {
            this.setLayout(saved, false);
        } else {
            this.autoLayout();
        }
    }
}

const layoutManager = new LayoutManager();

if (appHost.getDefaultLayout) {
    layoutManager.defaultLayout = appHost.getDefaultLayout();
}

layoutManager.init();

export default layoutManager;
