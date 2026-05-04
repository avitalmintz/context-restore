import { canonicalizeUrl, clusterTabs } from "../background/inference.js";
import { CATEGORY_LABELS } from "./constants.js";

export const STORAGE_KEYS = {
  snapshot: "tabSnapshot",
  clusters: "tabClusters",
  apiKey: "anthropicApiKey"
};

export const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
export const ALLOWED_CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));

export function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function getSnapshot() {
  const v = await chrome.storage.local.get([STORAGE_KEYS.snapshot]);
  return Array.isArray(v[STORAGE_KEYS.snapshot]) ? v[STORAGE_KEYS.snapshot] : [];
}

export async function saveSnapshot(items) {
  await chrome.storage.local.set({ [STORAGE_KEYS.snapshot]: items });
}

export async function getClusters() {
  const v = await chrome.storage.local.get([STORAGE_KEYS.clusters]);
  const raw = Array.isArray(v[STORAGE_KEYS.clusters]) ? v[STORAGE_KEYS.clusters] : [];
  let dirty = false;
  for (const c of raw) {
    if (!c.id) {
      c.id = newId();
      dirty = true;
    }
    if (!Array.isArray(c.tabUrls)) {
      c.tabUrls = [];
      dirty = true;
    }
  }
  if (dirty) {
    await chrome.storage.local.set({ [STORAGE_KEYS.clusters]: raw });
  }
  return raw;
}

export async function saveClusters(clusters) {
  await chrome.storage.local.set({ [STORAGE_KEYS.clusters]: clusters });
}

export async function getApiKey() {
  const v = await chrome.storage.local.get([STORAGE_KEYS.apiKey]);
  return String(v[STORAGE_KEYS.apiKey] || "");
}

export async function saveApiKey(key) {
  await chrome.storage.local.set({ [STORAGE_KEYS.apiKey]: key });
}

export function isSavableTab(tab) {
  return Boolean(tab && tab.url && /^https?:/i.test(tab.url) && !tab.pinned);
}

export async function addSingleTabToSnapshot(tab) {
  if (!isSavableTab(tab)) {
    return { added: false, reason: "Can't save this tab (not a normal http(s) page)." };
  }
  const url = canonicalizeUrl(tab.url);
  const snapshot = await getSnapshot();
  const existing = snapshot.find((t) => t.url === url);
  if (existing) {
    if (tab.title) existing.title = tab.title;
    if (tab.favIconUrl) existing.favIconUrl = tab.favIconUrl;
    await saveSnapshot(snapshot);
    return { added: false, alreadySaved: true, url, reason: "Already saved." };
  }
  snapshot.push({
    url,
    title: tab.title || url,
    favIconUrl: tab.favIconUrl || "",
    savedAt: Date.now()
  });
  await saveSnapshot(snapshot);
  return { added: true, url };
}

export async function mergeOpenTabsIntoSnapshot() {
  const all = await chrome.tabs.query({});
  const candidates = all.filter(isSavableTab);
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

export async function deleteSavedTab(url) {
  const snapshot = await getSnapshot();
  await saveSnapshot(snapshot.filter((t) => t.url !== url));

  const clusters = await getClusters();
  for (const c of clusters) {
    c.tabUrls = c.tabUrls.filter((u) => u !== url);
  }
  await saveClusters(clusters);
}

export async function moveTabToCluster(url, destClusterId, ungroupedSentinel) {
  const clusters = await getClusters();
  for (const c of clusters) {
    c.tabUrls = c.tabUrls.filter((u) => u !== url);
  }
  if (destClusterId && destClusterId !== ungroupedSentinel) {
    const dest = clusters.find((c) => c.id === destClusterId);
    if (dest && !dest.tabUrls.includes(url)) {
      dest.tabUrls.push(url);
    }
  }
  await saveClusters(clusters);
}

export async function createCluster(title = "New group", category = "other") {
  const clusters = await getClusters();
  const id = newId();
  clusters.unshift({ id, title, category, tabUrls: [] });
  await saveClusters(clusters);
  return id;
}

export async function deleteCluster(id) {
  const clusters = await getClusters();
  await saveClusters(clusters.filter((c) => c.id !== id));
}

export async function renameCluster(id, newTitle) {
  const clusters = await getClusters();
  const trimmed = String(newTitle || "").trim().slice(0, 80) || "Group";
  for (const c of clusters) {
    if (c.id === id) c.title = trimmed;
  }
  await saveClusters(clusters);
}

export function snapshotToTabs(snapshot) {
  return snapshot.map((s) => ({
    id: s.url,
    url: s.url,
    title: s.title,
    favIconUrl: s.favIconUrl,
    lastAccessed: s.savedAt,
    pinned: false
  }));
}

export function heuristicCluster(snapshot) {
  const tabs = snapshotToTabs(snapshot);
  const out = clusterTabs(tabs);
  return out.map((c) => ({
    id: newId(),
    title: c.title,
    category: c.category,
    tabUrls: c.tabIds
  }));
}

export const SYSTEM_PROMPT_INCREMENTAL = `You assign new browser tabs to existing groups, or create new groups for them.

You will receive a JSON object with:
- existing_groups: array of { id, title, category, sample_titles } - groups already created by the user, do not modify them, only assign tabs to their id.
- new_tabs: array of { i, title, url } - new tabs that need a home.

Output ONLY a JSON object (no markdown, no commentary):
{
  "assignments": [
    { "tabIndex": 0, "groupId": "<existing-id-or-tempId>" }
  ],
  "newGroups": [
    { "tempId": "n1", "title": "Short label (2-6 words)", "category": "ai|news|dev|research|shopping|travel|social|job|finance|food|entertainment|health|other" }
  ]
}

Rules:
- Every tab in new_tabs must have exactly one entry in assignments.
- To put a tab in an existing group, set groupId to that group's existing id.
- To put a tab in a new group, create an entry in newGroups with a tempId, then set the assignment's groupId to that tempId.
- Prefer existing groups when the theme fits. Only create a new group when no existing group is appropriate.
- Title should describe the theme (e.g. "AI Industry Coverage"), not just the category.
- Output valid JSON only.`;

export function extractJsonObject(raw) {
  const trimmed = String(raw || "").trim();
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object in response");
  }
  return JSON.parse(fenced.slice(start, end + 1));
}

export async function llmAssignIncremental(newTabs, existingClusters, apiKey) {
  if (!newTabs.length) return;

  const snapshot = await getSnapshot();
  const titlesByUrl = new Map(snapshot.map((t) => [t.url, t.title]));

  const existingPayload = existingClusters.map((c) => ({
    id: c.id,
    title: c.title,
    category: c.category,
    sample_titles: c.tabUrls.slice(0, 5).map((u) => (titlesByUrl.get(u) || u).slice(0, 100))
  }));

  const newPayload = newTabs.map((t, i) => ({
    i,
    title: String(t.title || "").slice(0, 200),
    url: t.url
  }));

  const userMessage = `Input:\n${JSON.stringify({ existing_groups: existingPayload, new_tabs: newPayload })}`;

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
      system: SYSTEM_PROMPT_INCREMENTAL,
      messages: [{ role: "user", content: userMessage }]
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Anthropic ${response.status}: ${errText.slice(0, 200) || response.statusText}`);
  }

  const data = await response.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock?.text) throw new Error("No text content in Anthropic response");

  const parsed = extractJsonObject(textBlock.text);

  const clusters = await getClusters();
  const tempIdToReal = new Map();

  for (const ng of Array.isArray(parsed.newGroups) ? parsed.newGroups : []) {
    const realId = newId();
    const category = ALLOWED_CATEGORIES.has(ng.category) ? ng.category : "other";
    clusters.push({
      id: realId,
      title: String(ng.title || "Group").slice(0, 80),
      category,
      tabUrls: []
    });
    if (ng.tempId) tempIdToReal.set(String(ng.tempId), realId);
  }

  const assignments = Array.isArray(parsed.assignments) ? parsed.assignments : [];
  const assigned = new Set();
  for (const a of assignments) {
    const i = Number(a?.tabIndex);
    if (!Number.isInteger(i) || i < 0 || i >= newTabs.length) continue;
    const tab = newTabs[i];
    if (!tab || assigned.has(tab.url)) continue;

    const requested = String(a?.groupId || "");
    const targetId = tempIdToReal.get(requested) || requested;
    const target = clusters.find((c) => c.id === targetId);
    if (!target) continue;
    if (!target.tabUrls.includes(tab.url)) target.tabUrls.push(tab.url);
    assigned.add(tab.url);
  }

  await saveClusters(clusters);
}
