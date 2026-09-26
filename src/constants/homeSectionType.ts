// NOTE: This should be included in the OpenAPI spec ideally
// https://github.com/jellyfin/jellyfin/blob/1b4394199a2f9883cd601bdb8c9d66015397aa52/Jellyfin.Data/Enums/HomeSectionType.cs
export enum HomeSectionType {
    None = 'none',
    SmallLibraryTiles = 'smalllibrarytiles',
    LibraryButtons = 'librarybuttons',
    ActiveRecordings = 'activerecordings',
    Resume = 'resume',
    ResumeAudio = 'resumeaudio',
    LatestMedia = 'latestmedia',
    NextUp = 'nextup',
    LiveTv = 'livetv',
    ResumeBook = 'resumebook'
}

// Fixed home screen order; overrides the server defaults and any user setting.
export const DEFAULT_SECTIONS: HomeSectionType[] = [
    HomeSectionType.Resume,
    HomeSectionType.ResumeAudio,
    HomeSectionType.ResumeBook,
    HomeSectionType.NextUp,
    HomeSectionType.SmallLibraryTiles,
    HomeSectionType.LatestMedia,
    HomeSectionType.LiveTv,
    HomeSectionType.None,
    HomeSectionType.None,
    HomeSectionType.None
];
