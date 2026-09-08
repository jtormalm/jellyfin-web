# Agent Instructions: Custom Jellyfin Web Maintenance

## Role & Context
This repository is a fork of `jellyfin/jellyfin-web`. It hosts customized UI layers (embedded CSS, bundled fonts, build-time asset injections) to eliminate runtime CSS lag and avoid blocking external Google Fonts requests.

The active development branch is `custom-ui`. The official repository must be tracked under the `upstream` remote.

---

## 1. Remote & Base Branch Setup

Ensure the official upstream repository is configured and up to date:

```bash
# Verify or add upstream remote
git remote get-url upstream || git remote add upstream [https://github.com/jellyfin/jellyfin-web.git](https://github.com/jellyfin/jellyfin-web.git)

# Fetch all upstream release branches and tags
git fetch upstream --tags --prune
```

### Initializing `custom-ui` from a Release
Always base the `custom-ui` branch on an upstream release branch (`release-10.X.z`) or release tag (`v10.X.Y`), never upstream `master`:

```bash
# Example: Base on the 10.11 release branch
git checkout -b custom-ui upstream/release-10.11.z

# Or base on a specific release tag
git checkout -b custom-ui v10.11.0
```

---

## 2. UI Customization Rules

- **Styles:** Place custom CSS in `src/assets/css/custom.css`.
- **Fonts:** Store `.woff2` font files in `src/assets/fonts/`. Define `@font-face` rules using `font-display: swap` directly in the local stylesheet.
- **Entry Points:** Import styles and fonts in `src/index.js` or link them inside `src/index.html`. Do not rely on Jellyfin's runtime Custom CSS settings in the dashboard.
- **Scope:** Confine custom edits to asset directories and direct entry files (`src/index.js`, `src/index.html`) to minimize upstream conflicts.

---

## 3. Upstream Update Protocol (Rebase Workflow)

When aligning with newer upstream releases:

1. **Fetch Latest Upstream Refs:**
   ```bash
   git fetch upstream --tags --prune
   ```
2. **Rebase `custom-ui`:**
   Replay local UI modifications on top of the target upstream release branch or tag:
   ```bash
   git checkout custom-ui
   git rebase upstream/release-10.11.z
   # or: git rebase <target-tag>
   ```
3. **Resolve Conflicts:**
   - Resolve conflicts if entry points (`src/index.js`, `src/index.html`) changed upstream.
   - Retain our custom asset imports and declarations.
   - Run `git rebase --continue`.
4. **Push:**
   ```bash
   git push origin custom-ui --force-with-lease
   ```

---

## 4. Build & Validation

Always verify the build succeeds and outputs to `dist/`:

```bash
npm ci
npm run build:production
```

---

## 5. Deployment & Updating the Live Server

After building `dist/`, sync the production build to the host's Jellyfin web directory and restart the container:

```bash
# 1. Sync built files to host web directory
rsync -av --delete /home/jakob/projects/jellyfin-web/dist/ /etc/plexconfig/jellyfin/web/

# 2. Restart Jellyfin container
docker compose -f /home/jakob/core.yml restart jellyfin
```
