import { playbackManager } from '../components/playback/playbackmanager';
import { appRouter } from '../components/router/appRouter';
import { ServerConnections } from 'lib/jellyfin-apiclient';

const AUTO_INTERVAL = 5000;
const REFRESH_INTERVAL = 60000;
const LOGO_TIMEOUT = 400;
const FADE_OUT_MS = 260;
const CACHE_PREFIX = 'spotlight-items-';
const FIELDS = 'Overview,RunTimeTicks,UserData,OfficialRating,CommunityRating,SeriesName,SeriesId,ParentIndexNumber,IndexNumber,PlaybackPositionTicks';

const SVG_PLAY = `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M320-273v-414q0-17 12-28.5t28-11.5q5 0 10.5 1.5T381-721l326 207q9 6 13.5 15t4.5 19q0 10-4.5 19T707-446L381-239q-5 3-10.5 4.5T360-233q-16 0-28-11.5T320-273Z"/></svg>`;
const SVG_INFO = `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M423.5-703.5Q400-727 400-760t23.5-56.5Q447-840 480-840t56.5 23.5Q560-793 560-760t-23.5 56.5Q513-680 480-680t-56.5-23.5Zm14 566Q420-155 420-180v-360q0-25 17.5-42.5T480-600q25 0 42.5 17.5T540-540v360q0 25-17.5 42.5T480-120q-25 0-42.5-17.5Z"/></svg>`;
const SVG_RATING = `<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="#e3e3e3"><path d="M168-144q-29 0-50.5-21.5T96-216v-528q0-29.7 21.5-50.85Q139-816 168-816h624q29 0 50.5 21.15T864-744v528q0 29-21.5 50.5T792-144H168Zm337.5-154.35Q516-308.7 516-324v-168q0-15.3-10.29-25.65Q495.42-528 480.21-528t-25.71 10.35Q444-507.3 444-492v168q0 15.3 10.29 25.65Q464.58-288 479.79-288t25.71-10.35ZM480-600q14 0 25-11t11-25.5q0-14.5-11-25T479.5-672q-14.5 0-25 10.35T444-636q0 14 10.35 25T480-600ZM168-228h72v-72h-72v72Zm552 0h72v-72h-72v72ZM168-372h72v-72h-72v72Zm552 0h72v-72h-72v72Zm552 0h72v-72h-72v72ZM168-516h72v-72h-72v72Zm552 0h72v-72h-72v72ZM168-660h72v-72h-72v72Zm552 0h72v-72h-72v72Z"/></svg>`;
const SVG_CLOCK = `<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="#e3e3e3"><path d="M516-510v-174q0-15.3-10.29-25.65Q495.42-720 480.21-720t-25.71 10.35Q444-699.3 444-684v189q0 8 3 14.5t8 11.5l133.85 133.85Q600-324 614.5-324.5 629-325 640-336t11-25.5q0-14.5-11.34-25.75L516-510ZM480-96q-79.38 0-149.19-30T208.5-208.5Q156-261 126-330.96t-30-149.5Q96-560 126-630q30-70 82.5-122t122.46-82q69.96-30 149.5-30t149.55 30.24q70 30.24 121.79 82.08 51.78 51.84 81.99 121.92Q864-559.68 864-480q0 79.38-30 149.19T752-208.5Q700-156 629.87-126T480-96Z"/></svg>`;
const SVG_STAR = `<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="#e3e3e3"><path d="m480-285-164 98q-11 6-21.5 5t-18.5-7q-8-6-12-16.5t-1-21.5l43-183-145-123q-9-8-11-18.5t1-20.5q3-10 11-16.5t20-7.5l190-17 75-174q5-11 14-16.5t19-5.5q10 0 19 5.5t14 16.5l75 175 190 16q12 1 20 8t11 17q3 10 .5 20T798-533L654-410l43 183q3 11-1 21.5T684-189q-8 6-18.5 7t-21.5-5l-164-98Z"/></svg>`;

export class NativeSpotlight {
    constructor(parentContainer) {
        this.parentContainer = parentContainer;
        this.container = null;
        this.items = [];
        this.currentIndex = 0;
        this.autoTimer = null;
        this.preloadTimer = null;
        this.renderController = null;
        this.preloadController = null;
        this.refreshController = null;
        this.refreshPromise = null;
        this.zoomAnimation = null;
        this.renderSequence = 0;
        this.lastRefresh = 0;
        this.renderedId = null;
        this.hasRendered = false;
        this.paused = true;
        this.disposed = false;
        this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

        this.touchStartX = 0;
        this.touchStartY = 0;
        this.touchTargetIsInteractive = false;

        this.onVisibilityChange = this.onVisibilityChange.bind(this);
        this.onTouchStart = this.onTouchStart.bind(this);
        this.onTouchEnd = this.onTouchEnd.bind(this);
        this.onReducedMotionChange = this.onReducedMotionChange.bind(this);
    }

    init() {
        if (this.container) return;

        const container = document.createElement('div');
        container.className = 'spotlight-container';
        container.innerHTML = `
            <div class="spotlight-backdrop"><img class="spotlight-backdrop-img" alt="" decoding="async" fetchpriority="high" /></div>
            <div class="spotlight-content">
                <img class="spotlight-logo" alt="" />
                <div class="spotlight-title"></div>
                <div class="spotlight-episode-label"></div>
                <div class="spotlight-meta"></div>
                <div class="spotlight-progress-wrap" style="display:none">
                    <div class="spotlight-progress-bar"></div>
                </div>
                <div class="spotlight-plot"></div>
                <div class="spotlight-buttons"></div>
            </div>
            <div class="spotlight-carousel-dots"></div>
            <button class="spotlight-clickzone" type="button" aria-label="View item details"></button>
            <div class="spotlight-empty" style="display:none">Nothing to show</div>
        `;

        this.container = container;
        this.backdrop = container.querySelector('.spotlight-backdrop');
        this.backdropImg = container.querySelector('.spotlight-backdrop-img');
        this.content = container.querySelector('.spotlight-content');
        this.logo = container.querySelector('.spotlight-logo');
        this.title = container.querySelector('.spotlight-title');
        this.episodeLabel = container.querySelector('.spotlight-episode-label');
        this.meta = container.querySelector('.spotlight-meta');
        this.progressWrap = container.querySelector('.spotlight-progress-wrap');
        this.progressBar = container.querySelector('.spotlight-progress-bar');
        this.plot = container.querySelector('.spotlight-plot');
        this.buttons = container.querySelector('.spotlight-buttons');
        this.dotsContainer = container.querySelector('.spotlight-carousel-dots');
        this.clickzone = container.querySelector('.spotlight-clickzone');
        this.emptyElem = container.querySelector('.spotlight-empty');

        this.parentContainer.insertBefore(container, this.parentContainer.firstChild);

        document.addEventListener('visibilitychange', this.onVisibilityChange);
        container.addEventListener('touchstart', this.onTouchStart, { passive: true });
        container.addEventListener('touchend', this.onTouchEnd, { passive: true });
        this.reducedMotion?.addEventListener?.('change', this.onReducedMotionChange);

        const indexPage = this.parentContainer.closest('#indexPage');
        if (indexPage) indexPage.classList.add('abyss-spotlight-active');
        const homeTab = this.parentContainer.closest('#homeTab');
        if (homeTab) homeTab.classList.add('abyss-spotlight-active');
    }

    getApiClient() {
        return ServerConnections.currentApiClient();
    }

    getUserId() {
        const client = this.getApiClient();
        return client ? client.getCurrentUserId() : null;
    }

    formatRuntime(ticks) {
        if (!ticks) return null;
        const mins = Math.floor(ticks / 600000000);
        if (mins < 60) return `${mins}m`;
        const hours = Math.floor(mins / 60);
        const remainder = mins % 60;
        return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
    }

    metaPillWithIcon(iconSvg, text) {
        const pill = document.createElement('span');
        const label = document.createElement('span');
        pill.className = 'spotlight-meta-pill';
        pill.innerHTML = iconSvg;
        label.textContent = String(text);
        pill.appendChild(label);
        return pill;
    }

    imageDimensions(type) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (type === 'Logo') {
            return {
                width: Math.max(960, Math.ceil(window.innerWidth * 0.55 * dpr)),
                height: Math.max(360, Math.ceil(120 * dpr))
            };
        }
        return {
            width: Math.min(2560, Math.max(1920, Math.ceil(window.innerWidth * dpr))),
            height: Math.min(1440, Math.max(1080, Math.ceil(window.innerHeight * dpr)))
        };
    }

    imageUrl(itemId, type, index = null) {
        const apiClient = this.getApiClient();
        if (!apiClient) return '';
        const { width, height } = this.imageDimensions(type);
        const options = {
            type,
            quality: 88,
            maxWidth: width,
            maxHeight: height
        };
        if (index != null) options.index = index;
        return apiClient.getScaledImageUrl(itemId, options);
    }

    preloadImage(url) {
        if (!url) return Promise.resolve(null);
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(url);
            img.onerror = () => resolve(null);
            img.src = url;
        });
    }

    async loadBackdrop(urls) {
        const backdrop = await this.preloadImage(urls.backdrop);
        if (backdrop || !urls.primary) return { url: backdrop, primary: false };
        return { url: await this.preloadImage(urls.primary), primary: true };
    }

    async fetchArtwork(item, signal) {
        const urls = this.itemImageUrls(item);
        const [backdrop, logo] = await Promise.all([this.loadBackdrop(urls), this.preloadImage(urls.logo)]);
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        return { backdrop, logo };
    }

    wait(ms, signal) {
        if (ms === 0) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, ms);
            signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
            }, { once: true });
        });
    }

    startZoom(image) {
        this.zoomAnimation?.cancel();
        this.zoomAnimation = null;
        image.style.transform = 'scale(1) translate(0, 0)';
        if (this.paused || this.reducedMotion.matches) return;
        const angle = Math.random() * Math.PI * 2;
        const panX = Math.cos(angle) * 1.5;
        const panY = Math.sin(angle) * 1.5;
        this.zoomAnimation = image.animate([
            { transform: 'scale(1) translate(0, 0)' },
            { transform: `scale(1.08) translate(${panX}%, ${panY}%)` }
        ], { duration: 9000, easing: 'linear', fill: 'forwards' });
    }

    async fetchItems(signal) {
        const apiClient = this.getApiClient();
        const userId = this.getUserId();
        if (!apiClient || !userId) return [];

        const MIN_ITEMS = 5;
        const MAX_ITEMS = 7;

        const [resumeResult, nextUpResult] = await Promise.allSettled([
            apiClient.getJSON(apiClient.getUrl(`Users/${userId}/Items/Resume`, {
                Limit: 3,
                Recursive: true,
                IncludeItemTypes: 'Movie,Episode',
                Fields: FIELDS,
                EnableTotalRecordCount: false
            })),
            apiClient.getJSON(apiClient.getUrl('Shows/NextUp', {
                Limit: 5,
                UserId: userId,
                Fields: FIELDS,
                EnableTotalRecordCount: false
            }))
        ]);

        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const resumeItems = resumeResult.status === 'fulfilled' ? resumeResult.value?.Items || [] : [];
        const nextUpItems = nextUpResult.status === 'fulfilled' ? nextUpResult.value?.Items || [] : [];
        const combined = [
            ...resumeItems.map(item => ({ ...item, _source: 'resume' })),
            ...nextUpItems.map(item => ({ ...item, _source: 'nextup' }))
        ];
        const picked = new Map(combined.map(item => [item.Id, item]));

        if (picked.size < MIN_ITEMS) {
            const recentQuery = (type) => apiClient.getJSON(apiClient.getUrl(`Users/${userId}/Items`, {
                Limit: MAX_ITEMS,
                Recursive: true,
                SortBy: 'DateCreated',
                SortOrder: 'Descending',
                IncludeItemTypes: type,
                Fields: FIELDS,
                EnableTotalRecordCount: false
            }));
            const recent = await Promise.allSettled([recentQuery('Movie'), recentQuery('Series')]);
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

            const sources = ['recent-movie', 'recent-show'];
            recent.forEach((result, index) => {
                if (result.status !== 'fulfilled') {
                    console.warn(`[Spotlight] Failed to load ${sources[index]} items:`, result.reason);
                    return;
                }
                for (const item of result.value?.Items || []) {
                    if (picked.size >= MAX_ITEMS) break;
                    if (!picked.has(item.Id)) picked.set(item.Id, { ...item, _source: sources[index] });
                }
            });
        }

        return [...picked.values()].slice(0, MAX_ITEMS);
    }

    stopAuto() {
        if (this.autoTimer) clearTimeout(this.autoTimer);
        this.autoTimer = null;
    }

    startAuto() {
        this.stopAuto();
        if (this.paused || this.disposed || this.items.length <= 1 || this.reducedMotion.matches) return;
        this.autoTimer = setTimeout(async () => {
            this.currentIndex = (this.currentIndex + 1) % this.items.length;
            await this.renderItem(this.currentIndex);
            this.startAuto();
        }, AUTO_INTERVAL);
    }

    updateDots() {
        if (!this.dotsContainer) return;
        const dots = [...this.dotsContainer.querySelectorAll('.spotlight-dot')];
        dots.forEach((dot, index) => {
            const distance = Math.abs(index - this.currentIndex);
            dot.className = 'spotlight-dot ' + (distance === 0 ? 'dot-active' : distance === 1 ? 'dot-near' : distance === 2 ? 'dot-far' : 'dot-hidden');
            dot.setAttribute('aria-current', distance === 0 ? 'true' : 'false');
        });
    }

    async selectItem(index) {
        if (this.paused || this.disposed || this.items.length < 2) return;
        this.stopAuto();
        this.currentIndex = (index + this.items.length) % this.items.length;
        await this.renderItem(this.currentIndex);
        this.startAuto();
    }

    buildDots() {
        if (!this.dotsContainer) return;
        while (this.dotsContainer.firstChild) this.dotsContainer.removeChild(this.dotsContainer.firstChild);
        this.dotsContainer.style.display = this.items.length > 1 ? 'flex' : 'none';
        this.items.forEach((_, index) => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'spotlight-dot';
            dot.setAttribute('aria-label', `Show item ${index + 1}`);
            dot.addEventListener('click', event => {
                event.stopPropagation();
                this.selectItem(index);
            });
            this.dotsContainer.appendChild(dot);
        });
        this.updateDots();
    }

    itemImageUrls(item) {
        const isEpisode = item.Type === 'Episode';
        const artworkId = isEpisode ? item.SeriesId || item.Id : item.Id;
        return {
            primary: isEpisode ? this.imageUrl(item.Id, 'Primary') : null,
            backdrop: this.imageUrl(artworkId, 'Backdrop', 0),
            logo: this.imageUrl(artworkId, 'Logo')
        };
    }

    queuePreload() {
        if (this.preloadTimer) clearTimeout(this.preloadTimer);
        this.preloadController?.abort();
        if (this.paused || this.items.length <= 1) return;
        this.preloadController = new AbortController();
        const next = this.items[(this.currentIndex + 1) % this.items.length];
        this.preloadTimer = setTimeout(() => {
            this.fetchArtwork(next, this.preloadController.signal).catch(() => {});
        }, 250);
    }

    setButtonContent(button, icon, label = '') {
        button.innerHTML = icon;
        if (label) {
            const text = document.createElement('span');
            text.textContent = label;
            button.appendChild(text);
        }
    }

    triggerPlayback(item) {
        const startPositionTicks = item._source === 'resume' ? item.UserData?.PlaybackPositionTicks || 0 : 0;
        playbackManager.play({
            items: [item],
            startPositionTicks
        }).catch(() => {
            appRouter.showItem(item.Id);
        });
    }

    updateBackdrop(backdrop) {
        if (backdrop.url) {
            this.backdropImg.src = backdrop.url;
            this.backdropImg.style.objectPosition = backdrop.primary ? 'center center' : 'center 20%';
            this.backdrop.classList.add('loaded');
            this.startZoom(this.backdropImg);
        } else {
            this.zoomAnimation?.cancel();
            this.zoomAnimation = null;
            this.backdropImg.removeAttribute('src');
            this.backdropImg.style.transform = '';
            this.backdrop.classList.add('loaded');
        }
    }

    updateContent(item, logo) {
        const isEpisode = item.Type === 'Episode';
        const title = isEpisode ? item.SeriesName || item.Name : item.Name;

        let episodePrefix = '';
        if (logo) {
            this.logo.src = logo;
            this.logo.style.display = 'block';
            this.title.style.display = 'none';
        } else {
            this.logo.removeAttribute('src');
            this.logo.style.display = 'none';
            this.title.style.display = 'block';
            this.title.textContent = title;
        }

        if (isEpisode) {
            const parts = [];
            if (item.ParentIndexNumber != null && item.IndexNumber != null) {
                episodePrefix = `S${item.ParentIndexNumber} E${item.IndexNumber}`;
                parts.push(episodePrefix);
            }
            if (item.Name) parts.push(item.Name);
            this.episodeLabel.textContent = parts.join('  \u2013  ');
            this.episodeLabel.style.display = 'block';
        } else {
            this.episodeLabel.textContent = '';
            this.episodeLabel.style.display = 'none';
        }

        const isResume = item._source === 'resume';
        const playLabel = isResume ? (isEpisode ? `Continue ${episodePrefix}` : 'Resume') : (isEpisode ? `Play ${episodePrefix}`.trim() : 'Play');

        const playButton = document.createElement('button');
        playButton.type = 'button';
        playButton.className = 'spotlight-btn spotlight-btn-play';
        this.setButtonContent(playButton, SVG_PLAY, playLabel);
        playButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.triggerPlayback(item);
        });

        const infoButton = document.createElement('a');
        infoButton.className = 'spotlight-btn spotlight-btn-info';
        infoButton.href = `#/details?id=${item.Id}`;
        infoButton.setAttribute('aria-label', `View details for ${title}`);
        this.setButtonContent(infoButton, SVG_INFO);
        infoButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            appRouter.showItem(item.Id);
        });

        while (this.buttons.firstChild) this.buttons.removeChild(this.buttons.firstChild);
        this.buttons.appendChild(playButton);
        this.buttons.appendChild(infoButton);

        while (this.meta.firstChild) this.meta.removeChild(this.meta.firstChild);
        if (item.OfficialRating) this.meta.appendChild(this.metaPillWithIcon(SVG_RATING, item.OfficialRating));
        const runtime = this.formatRuntime(item.RunTimeTicks);
        if (runtime) this.meta.appendChild(this.metaPillWithIcon(SVG_CLOCK, runtime));
        const rating = Number(item.CommunityRating);
        if (Number.isFinite(rating) && rating > 0) this.meta.appendChild(this.metaPillWithIcon(SVG_STAR, rating.toFixed(1)));

        const userData = item.UserData || {};
        const played = Number(userData.PlayedPercentage);
        this.progressWrap.style.display = played > 0 && isResume ? 'block' : 'none';
        this.progressBar.style.width = `${Math.min(Math.max(played || 0, 0), 100)}%`;

        this.plot.textContent = item.Overview || '';

        this.clickzone.setAttribute('aria-label', `View details for ${title}`);
        this.clickzone.onclick = () => appRouter.showItem(item.Id);
    }

    async renderItem(index) {
        const item = this.items[index];
        if (!item || this.paused || this.disposed) return false;
        this.renderController?.abort();
        this.renderController = new AbortController();
        const { signal } = this.renderController;
        const sequence = ++this.renderSequence;
        const isCurrent = () => !signal.aborted && sequence === this.renderSequence;
        this.renderedId = item.Id;
        this.updateDots();

        try {
            const urls = this.itemImageUrls(item);
            const logoPromise = this.preloadImage(urls.logo);
            const backdropPromise = this.loadBackdrop(urls);

            // First paint: show the text as soon as possible and let the backdrop fade in when it
            // arrives. Later slides wait for all artwork so text never sits on the old backdrop.
            const progressive = !this.hasRendered;
            let logo;
            let backdrop;
            if (progressive) {
                logo = await Promise.race([logoPromise, this.wait(LOGO_TIMEOUT, signal).then(() => null)]);
            } else {
                [logo, backdrop] = await Promise.all([logoPromise, backdropPromise]);
            }
            if (!isCurrent()) return false;

            this.content.classList.remove('visible');
            this.backdrop.classList.remove('loaded');
            // Let the previous slide fade out before swapping content (nothing to fade on first paint).
            if (!progressive) {
                await this.wait(this.reducedMotion.matches ? 0 : FADE_OUT_MS, signal);
                if (!isCurrent()) return false;
            }
            this.updateContent(item, logo);
            this.content.classList.add('visible');
            this.hasRendered = true;

            if (progressive) backdrop = await backdropPromise;
            if (!isCurrent()) return false;
            this.updateBackdrop(backdrop);
            this.queuePreload();
            return true;
        } catch (error) {
            if (error.name !== 'AbortError') console.error('[Native Spotlight] render error:', error);
            return false;
        }
    }

    cacheKey() {
        const apiClient = this.getApiClient();
        const userId = this.getUserId();
        return apiClient && userId ? `${CACHE_PREFIX}${apiClient.serverId()}-${userId}` : null;
    }

    restoreCachedItems() {
        const key = this.cacheKey();
        if (!key) return false;
        try {
            const cached = JSON.parse(localStorage.getItem(key) || 'null');
            if (!Array.isArray(cached) || !cached.length) return false;
            this.items = cached;
            this.currentIndex = 0;
            this.buildDots();
            return true;
        } catch {
            return false;
        }
    }

    saveCachedItems() {
        const key = this.cacheKey();
        if (!key) return;
        try {
            localStorage.setItem(key, JSON.stringify(this.items));
        } catch {
            // Storage unavailable or full; the cache is only a startup optimisation.
        }
    }

    async refreshItems() {
        if (this.refreshPromise) return this.refreshPromise;
        this.refreshController?.abort();
        this.refreshController = new AbortController();
        this.refreshPromise = (async () => {
            const nextItems = await this.fetchItems(this.refreshController.signal);
            if (this.paused || this.disposed) return;

            // Never swap out the slide the user is looking at (e.g. one restored from cache):
            // keep it first and fill the rest of the carousel with the fresh items.
            const shown = this.items.find(item => item.Id === this.renderedId);
            if (shown) {
                const fresh = nextItems.find(item => item.Id === shown.Id) || shown;
                const rest = nextItems.filter(item => item.Id !== shown.Id);
                this.items = [fresh, ...rest].slice(0, Math.max(nextItems.length, 1));
            } else {
                this.items = nextItems;
            }
            this.currentIndex = 0;
            this.lastRefresh = Date.now();
            if (this.emptyElem) this.emptyElem.style.display = this.items.length ? 'none' : 'flex';
            this.saveCachedItems();
            this.buildDots();
            if (this.items.length && !shown) await this.renderItem(this.currentIndex);
        })();

        try {
            await this.refreshPromise;
        } catch (error) {
            if (error.name !== 'AbortError') console.error('[Native Spotlight] refresh error:', error);
        } finally {
            this.refreshPromise = null;
        }
    }

    pause() {
        if (this.paused || this.disposed) return;
        this.paused = true;
        this.stopAuto();
        if (this.preloadTimer) clearTimeout(this.preloadTimer);
        this.preloadTimer = null;
        this.renderController?.abort();
        this.preloadController?.abort();
        this.refreshController?.abort();
        this.zoomAnimation?.cancel();
        this.zoomAnimation = null;
    }

    async resume() {
        if (this.disposed) return;
        this.init();
        if (this.container) this.container.style.display = 'block';
        const wasPaused = this.paused;
        this.paused = false;
        if (!this.items.length) this.restoreCachedItems();
        const stale = !this.items.length || Date.now() - this.lastRefresh > REFRESH_INTERVAL;
        if (wasPaused && this.items.length) {
            this.renderedId = null;
            const rendering = this.renderItem(this.currentIndex);
            if (!stale) await rendering;
        }
        if (stale) await this.refreshItems();
        this.startAuto();
    }

    onVisibilityChange() {
        if (this.disposed) return;
        if (document.hidden) {
            this.stopAuto();
            if (this.zoomAnimation) {
                this.zoomAnimation.pause();
            }
        } else {
            if (!this.paused) {
                if (this.zoomAnimation && this.zoomAnimation.playState === 'paused') {
                    this.zoomAnimation.play();
                } else if (!this.zoomAnimation && this.backdropImg && !this.reducedMotion.matches) {
                    this.startZoom(this.backdropImg);
                }
                this.startAuto();
            }
        }
    }

    onTouchStart(event) {
        const touch = event.changedTouches[0];
        this.touchStartX = touch.screenX;
        this.touchStartY = touch.screenY;
        this.touchTargetIsInteractive = Boolean(event.target.closest('button, a, input, select, textarea'));
    }

    onTouchEnd(event) {
        if (this.touchTargetIsInteractive || this.paused || this.items.length < 2) return;
        const touch = event.changedTouches[0];
        const deltaX = touch.screenX - this.touchStartX;
        const deltaY = touch.screenY - this.touchStartY;
        if (Math.abs(deltaX) < 50 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
        this.selectItem(this.currentIndex + (deltaX < 0 ? 1 : -1));
    }

    onReducedMotionChange() {
        if (this.reducedMotion.matches) {
            this.zoomAnimation?.cancel();
            this.zoomAnimation = null;
            this.stopAuto();
        } else if (!this.paused) {
            if (this.backdropImg) this.startZoom(this.backdropImg);
            this.startAuto();
        }
    }

    destroy() {
        if (this.disposed) return;
        this.disposed = true;
        this.pause();
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        if (this.container) {
            this.container.removeEventListener('touchstart', this.onTouchStart);
            this.container.removeEventListener('touchend', this.onTouchEnd);
            this.container.remove();
            this.container = null;
        }
        this.reducedMotion?.removeEventListener?.('change', this.onReducedMotionChange);
    }
}
