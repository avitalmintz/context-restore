# Semantic Tab Groups

Chrome extension that opens a single scrollable page showing tabs you've saved, clustered by what they're about. Uses the Anthropic API (Claude Haiku) for true semantic clustering — multiple AI articles from different news sites land in one group, multiple shopping pages from different retailers land in another. Falls back to keyword heuristics if no API key is set.

The page is a snapshot — closing a tab in your browser doesn't remove it from the list.

## Load in Chrome
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this `extension/` folder

## Set up the API key
1. Get a key from [console.anthropic.com](https://console.anthropic.com/) → Settings → API Keys.
2. Click the toolbar icon to open the groups page.
3. Click **Settings**, paste the key (starts with `sk-ant-`), click **Save**.

The key is stored in `chrome.storage.local` and only sent to `api.anthropic.com` when you press Refresh. Each Refresh costs roughly $0.001 with Claude Haiku.

## Use it
- Click the toolbar icon → opens the groups page.
- Click **Refresh** → adds your currently open tabs to the saved set, then asks Claude to cluster them all.
- Click any tab in the list → focuses it if still open, otherwise opens it as a new tab.
- Hover a tab and click **×** → removes it from the saved set.
- Closing a tab in your browser does NOT remove it from the list.

## Files
- `manifest.json` — extension manifest, `tabs` + `storage` permissions, host permission for api.anthropic.com
- `src/background/service-worker.js` — opens the groups page on toolbar click
- `src/background/inference.js` — heuristic clusterer (fallback)
- `src/groups/groups.html` + `groups.js` — the scrollable groups page, snapshot storage, Anthropic API call
- `src/shared/constants.js` — category colors and labels
