# Semantic Tab Groups

Chrome extension that opens a single scrollable page where your tabs are saved and clustered by what they're about. Uses the Anthropic API (Claude Haiku) for semantic clustering — multiple AI articles from different news sites land in one group, multiple shopping pages from different retailers land in another. Falls back to keyword heuristics if no API key is set.

The page is a snapshot — closing a tab in your browser doesn't remove it from the list. You can drag tabs between groups, rename groups, create empty groups, and delete tabs you're done with.

## Load in Chrome
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this `extension/` folder

## Set up the API key
1. Get a key from [console.anthropic.com](https://console.anthropic.com/) → Settings → API Keys.
2. Click the toolbar icon to open the groups page.
3. Click **Settings**, paste the key (starts with `sk-ant-`), click **Save**.

The key is stored in `chrome.storage.local` and only sent to `api.anthropic.com` when you press Refresh. Each Refresh costs roughly $0.001.

## Use it
- **Open** — click the toolbar icon.
- **Refresh** — adds your currently open tabs to the saved set, then asks Claude where the new ones should go (existing groups or new groups). Existing groups and your edits are preserved.
- **+ New group** — creates an empty group at the top, ready to drag tabs into.
- **Drag a tab** between groups to move it; drag onto **Ungrouped tabs** to pull it out of any group.
- **Click a group title** to rename it. Enter to save, Esc to cancel.
- **Hover a group** → click **×** in the header to delete the group (its tabs go to Ungrouped).
- **Hover a tab** → click **×** to remove the tab from the saved set entirely.
- **Click a tab row** to focus it if still open, otherwise reopen its URL in a new tab.
- Closing a tab in your browser does NOT remove it from the list.

## Files
- `manifest.json` — extension manifest, `tabs` + `storage` permissions, host permission for api.anthropic.com
- `src/background/service-worker.js` — opens the groups page on toolbar click
- `src/background/inference.js` — heuristic clusterer (fallback)
- `src/groups/groups.html` + `groups.js` — the scrollable groups page, snapshot storage, drag-and-drop, Anthropic API call
- `src/shared/constants.js` — category colors and labels
