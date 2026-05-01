import { clusterTabs, canonicalizeUrl } from "../background/inference.js";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "../shared/constants.js";

const STORAGE_KEYS = {
  snapshot: "tabSnapshot",
  clusters: "tabClusters",
  apiKey: "anthropicApiKey"
};

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ALLOWED_CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));

const groupsEl = document.getElementById("groups");
const ungroupedEl = document.getElementById("ungrouped");
const emptyEl = document.getElementById("empty");
const refreshBtn = document.getElementById("refresh");
const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
const apiKeyInput = document.getElementById("api-key");
const saveSettingsBtn = document.getElementById("save-settings");
const cancelSettingsBtn = document.getElementById("cancel-settings");
const statusEl = document.getElementById("status");

function safeDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function setStatus(text, variant = "info") {
  statusEl.textContent = text || "";
  statusEl.className = variant === "error" ? "error" : "";
}

async function getSnapshot() {
  const v = await chrome.storage.local.get([STORAGE_KEYS.snapshot]);
  return Array.isArray(v[STORAGE_KEYS.snapshot]) ? v[STORAGE_KEYS.snapshot] : [];
}

async function saveSnapshot(items) {
  await chrome.storage.local.set({ [STORAGE_KEYS.snapshot]: items });
}

async function getClusters() {
  const v = await chrome.storage.local.get([STORAGE_KEYS.clusters]);
  return Array.isArray(v[STORAGE_KEYS.clusters]) ? v[STORAGE_KEYS.clusters] : [];
}

async function saveClusters(clusters) {
  await chrome.storage.local.set({ [STORAGE_KEYS.clusters]: clusters });
}

async function getApiKey() {
  const v = await chrome.storage.local.get([STORAGE_KEYS.apiKey]);
  return String(v[STORAGE_KEYS.apiKey] || "");
}

async function saveApiKey(key) {
  await chrome.storage.local.set({ [STORAGE_KEYS.apiKey]: key });
}

async function mergeOpenTabsIntoSnapshot() {
  const all = await chrome.tabs.query({});
  const candidates = all.filter(
    (t) => t.url && /^https?:/i.test(t.url) && !t.pinned
  );
  const existing = await getSnapshot();
  const byUrl = new Map(existing.map((t) => [t.url, t]));
  const now = Date.now();

  for (const tab of candidates) {
    const url = canonicalizeUrl(tab.url);
    const prior = byUrl.get(url);
    if (prior) {
      if (tab.title) prior.title = tab.title;
      if (tab.favIconUrl) prior.favIconUrl = tab.favIconUrl;
    } else {
      byUrl.set(url, {
        url,
        title: tab.title || url,
        favIconUrl: tab.favIconUrl || "",
        savedAt: now
      });
    }
  }

  const updated = [...byUrl.values()];
  await saveSnapshot(updated);
  return updated;
}

async function deleteSavedTab(url) {
  const snapshot = await getSnapshot();
  await saveSnapshot(snapshot.filter((t) => t.url !== url));

  const clusters = await getClusters();
  const updated = clusters
    .map((c) => ({ ...c, tabUrls: c.tabUrls.filter((u) => u !== url) }))
    .filter((c) => c.tabUrls.length > 0);
  await saveClusters(updated);
}

async function focusOrOpen(url) {
  const all = await chrome.tabs.query({});
  const match = all.find((t) => canonicalizeUrl(t.url || "") === url);
  if (match) {
    await chrome.tabs.update(match.id, { active: true });
    if (match.windowId) {
      await chrome.windows.update(match.windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url });
  }
}

function snapshotToTabs(snapshot) {
  return snapshot.map((s) => ({
    id: s.url,
    url: s.url,
    title: s.title,
    favIconUrl: s.favIconUrl,
    lastAccessed: s.savedAt,
    pinned: false
  }));
}

function heuristicCluster(snapshot) {
  const tabs = snapshotToTabs(snapshot);
  const out = clusterTabs(tabs);
  return out.map((c) => ({
    title: c.title,
    category: c.category,
    tabUrls: c.tabIds
  }));
}

const SYSTEM_PROMPT = `You cluster browser tabs by semantic theme. Read each tab's title and URL, understand what the page is about, and group tabs that share a theme — even if they're on different domains.

Examples of good clustering:
- Articles about AI from WSJ, NYT, The Guardian → one group "AI Industry Coverage"
- Product pages from Reformation, Aritzia, J.Crew → one group "Clothing Shopping"
- A GitHub repo, its docs, and a Stack Overflow question about it → one group named after the project

Output ONLY a JSON object (no markdown fences, no commentary) with this shape:
{
  "groups": [
    {
      "title": "Short label (2-6 words, capitalized)",
      "category": "ai" | "news" | "dev" | "research" | "shopping" | "travel" | "social" | "job" | "finance" | "food" | "entertainment" | "health" | "other",
      "indices": [0, 1, 2]
    }
  ]
}

Rules:
- Every input index must appear in exactly one group's indices.
- Title should describe the theme of the tabs, not just the category. Prefer "AI Industry Coverage" over "AI".
- A tab with no related companions can be in its own 1-element group with a meaningful title.
- Pick the most specific category from the list. Use "other" only if nothing fits.
- Output valid JSON only. No backticks, no commentary.`;

function extractJsonObject(raw) {
  const trimmed = String(raw || "").trim();
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in response");
  }
  return JSON.parse(fenced.slice(start, end + 1));
}

async function llmCluster(snapshot, apiKey) {
  if (!snapshot.length) return [];

  const inputs = snapshot.map((t, i) => ({
    i,
    title: String(t.title || "").slice(0, 200),
    url: t.url
  }));

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Cluster these tabs:\n${JSON.stringify(inputs)}`
        }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Anthropic ${response.status}: ${errText.slice(0, 200) || response.statusText}`);
  }

  const data = await response.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("No text content in Anthropic response");
  }

  const parsed = extractJsonObject(textBlock.text);
  if (!Array.isArray(parsed?.groups)) {
    throw new Error("Response missing 'groups' array");
  }

  const seen = new Set();
  const result = [];
  for (const g of parsed.groups) {
    const indices = Array.isArray(g?.indices) ? g.indices : [];
    const tabUrls = indices
      .filter((i) => Number.isInteger(i) && i >= 0 && i < snapshot.length)
      .map((i) => snapshot[i].url)
      .filter((u) => u && !seen.has(u))
      .map((u) => { seen.add(u); return u; });
    if (!tabUrls.length) continue;
    const category = ALLOWED_CATEGORIES.has(g?.category) ? g.category : "other";
    result.push({
      title: String(g?.title || "Group").slice(0, 80),
      category,
      tabUrls
    });
  }

  const remaining = snapshot.filter((t) => !seen.has(t.url));
  for (const tab of remaining) {
    result.push({
      title: tab.title?.slice(0, 60) || safeDomain(tab.url) || "Tab",
      category: "other",
      tabUrls: [tab.url]
    });
  }

  return result;
}

function tabRow(tab, onDelete) {
  const li = document.createElement("li");
  li.className = "tab-row";

  const favicon = document.createElement("img");
  favicon.className = "favicon";
  favicon.alt = "";
  if (tab.favIconUrl) {
    favicon.src = tab.favIconUrl;
    favicon.addEventListener("error", () => {
      favicon.style.visibility = "hidden";
    });
  } else {
    favicon.style.visibility = "hidden";
  }

  const text = document.createElement("div");
  text.className = "tab-text";

  const title = document.createElement("div");
  title.className = "tab-title";
  title.textContent = tab.title || tab.url;

  const domain = document.createElement("div");
  domain.className = "tab-domain";
  domain.textContent = safeDomain(tab.url);

  text.appendChild(title);
  text.appendChild(domain);

  const del = document.createElement("button");
  del.className = "delete-btn";
  del.title = "Remove from list";
  del.textContent = "×";
  del.addEventListener("click", async (event) => {
    event.stopPropagation();
    await onDelete(tab.url);
  });

  li.appendChild(favicon);
  li.appendChild(text);
  li.appendChild(del);
  li.addEventListener("click", () => focusOrOpen(tab.url));
  return li;
}

function buildGroupCard(headLabel, headColor, titleText, count, tabsForList, onDelete) {
  const wrapper = document.createElement("section");
  wrapper.className = "group";

  const head = document.createElement("div");
  head.className = "group-head";

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.style.background = headColor;
  badge.textContent = headLabel;

  const title = document.createElement("div");
  title.className = "group-title";
  title.textContent = titleText;

  const countEl = document.createElement("span");
  countEl.className = "count";
  countEl.textContent = `${count} tab${count === 1 ? "" : "s"}`;

  head.appendChild(badge);
  head.appendChild(title);
  head.appendChild(countEl);
  wrapper.appendChild(head);

  const list = document.createElement("ul");
  list.className = "tabs-list";
  for (const t of tabsForList) {
    list.appendChild(tabRow(t, onDelete));
  }
  wrapper.appendChild(list);
  return wrapper;
}

async function render() {
  groupsEl.innerHTML = "";
  ungroupedEl.innerHTML = "";
  emptyEl.hidden = true;

  const [snapshot, clusters] = await Promise.all([getSnapshot(), getClusters()]);
  if (!snapshot.length) {
    emptyEl.hidden = false;
    return;
  }

  const tabsByUrl = new Map(snapshot.map((t) => [t.url, t]));

  const onDelete = async (url) => {
    await deleteSavedTab(url);
    await render();
  };

  const usedUrls = new Set();
  const multi = clusters.filter((c) => c.tabUrls.length >= 2);
  const solo = clusters.filter((c) => c.tabUrls.length === 1);

  for (const cluster of multi) {
    const tabsForList = cluster.tabUrls.map((u) => tabsByUrl.get(u)).filter(Boolean);
    if (!tabsForList.length) continue;
    for (const t of tabsForList) usedUrls.add(t.url);
    groupsEl.appendChild(
      buildGroupCard(
        CATEGORY_LABELS[cluster.category] || "Other",
        CATEGORY_COLORS[cluster.category] || CATEGORY_COLORS.other,
        cluster.title || "Group",
        tabsForList.length,
        tabsForList,
        onDelete
      )
    );
  }

  const ungroupedTabs = [];
  for (const cluster of solo) {
    const tab = tabsByUrl.get(cluster.tabUrls[0]);
    if (tab) {
      ungroupedTabs.push(tab);
      usedUrls.add(tab.url);
    }
  }
  for (const tab of snapshot) {
    if (!usedUrls.has(tab.url)) ungroupedTabs.push(tab);
  }

  if (ungroupedTabs.length) {
    ungroupedEl.appendChild(
      buildGroupCard(
        "Solo",
        CATEGORY_COLORS.other,
        "Ungrouped tabs",
        ungroupedTabs.length,
        ungroupedTabs,
        onDelete
      )
    );
  }

  if (!multi.length && !ungroupedTabs.length) {
    emptyEl.hidden = false;
  }
}

async function runRefresh() {
  refreshBtn.disabled = true;
  setStatus("Adding open tabs…");

  try {
    const snapshot = await mergeOpenTabsIntoSnapshot();
    if (!snapshot.length) {
      await saveClusters([]);
      setStatus("");
      await render();
      return;
    }

    const apiKey = await getApiKey();
    let clusters;
    if (apiKey) {
      setStatus("Asking Claude to cluster semantically…");
      try {
        clusters = await llmCluster(snapshot, apiKey);
        setStatus(`Clustered ${snapshot.length} tabs with Claude.`);
      } catch (err) {
        console.error(err);
        clusters = heuristicCluster(snapshot);
        setStatus(`Claude call failed (${err.message}). Used keyword fallback.`, "error");
      }
    } else {
      clusters = heuristicCluster(snapshot);
      setStatus("Add an API key in Settings for true semantic grouping. Used keyword fallback.");
    }

    await saveClusters(clusters);
    await render();
  } finally {
    refreshBtn.disabled = false;
  }
}

settingsToggle.addEventListener("click", async () => {
  if (settingsPanel.hidden) {
    apiKeyInput.value = await getApiKey();
    settingsPanel.hidden = false;
    apiKeyInput.focus();
  } else {
    settingsPanel.hidden = true;
  }
});

cancelSettingsBtn.addEventListener("click", () => {
  settingsPanel.hidden = true;
});

saveSettingsBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  await saveApiKey(key);
  settingsPanel.hidden = true;
  setStatus(key ? "API key saved. Press Refresh." : "API key cleared.");
});

refreshBtn.addEventListener("click", runRefresh);

render();
