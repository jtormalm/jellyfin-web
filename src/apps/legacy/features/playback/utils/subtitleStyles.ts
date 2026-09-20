import { SubtitleStylingOption } from 'apps/legacy/features/playback/constants/subtitleStylingOption';
import type { UserSettings } from 'scripts/settings/userSettings';

// TODO: This type override should be removed when userSettings are properly typed
interface SubtitleAppearanceSettings {
    subtitleStyling: SubtitleStylingOption
}

export function useCustomSubtitles(userSettings: UserSettings) {
    const subtitleAppearance = userSettings.getSubtitleAppearanceSettings() as SubtitleAppearanceSettings;
    // Custom-element rendering is a real, JS-controlled DOM node (unlike
    // native <track> cues, which render in a closed UA shadow tree with no
    // way to reposition them relative to the video OSD), so always use it
    // unless the user has explicitly opted into native rendering.
    return subtitleAppearance.subtitleStyling !== SubtitleStylingOption.Native;
}
