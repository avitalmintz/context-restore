import { clusterTabs, canonicalizeUrl } from "../background/inference.js";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "../shared/constants.js";

const STORAGE_KEYS = {
  snapshot: "tabSnapshot",
  clusters: "tabClusters",
  apiKey: "anthropicApiKey"
};

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ALLOWED_CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));
const UNGROUPED_ID = "__ungrouped__";

const groupsEl = document.getElementById("groups");
const ungroupedEl = document.getElementById("ungrouped");
const emptyEl = document.getElementById("empty");
const refreshBtn = document.getElementById("refresh");
const newGroupBtn = document.getElementById("new-group");
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

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
  for (const c of clusters) {
    c.tabUrls = c.tabUrls.filter((u) => u !== url);
  }
  await saveClusters(clusters);
}

async function moveTabToCluster(url, destClusterId) {
  const clusters = await getClusters();
  for (const c of clusters) {
    c.tabUrls = c.tabUrls.filter((u) => u !== url);
  }
  if (destClusterId && destClusterId !== UNGROUPED_ID) {
    const dest = clusters.find((c) => c.id === destClusterId);
    if (dest && !dest.tabUrls.includes(url)) {
      dest.tabUrls.push(url);
    }
  }
  await saveClusters(clusters);
}

async function createCluster(title = "New group", category = "other") {
  const clusters = await getClusters();
  const id = newId();
  clusters.unshift({ id, title, category, tabUrls: [] });
  await saveClusters(clusters);
  return id;
}

async function deleteCluster(id) {
  const clusters = await getClusters();
  await saveClusters(clusters.filter((c) => c.id !== id));
}

async function renameCluster(id, newTitle) {
  const clusters = await getClusters();
  const trimmed = String(newTitle || "").trim().slice(0, 80) || "Group";
  for (const c of clusters) {
    if (c.id === id) c.title = trimmed;
  }
  await saveClusters(clusters);
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
    id: newId(),
    title: c.title,
    category: c.category,
    tabUrls: c.tabIds
  }));
}

const SYSTEM_PROMPT_INCREMENTAL = `You assign new browser tabs to existing groups, or create new groups for them.

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

function extractJsonObject(raw) {
  const trimmed = String(raw || "").trim();
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object in response");
  }
  return JSON.parse(fenced.slice(start, end + 1));
}

async function llmAssignIncremental(newTabs, existingClusters, apiKey) {
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

function tabRow(tab, onDelete) {
  const li = document.createElement("li");
  li.className = "tab-row";
  li.draggable = true;
  li.dataset.url = tab.url;

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
  del.draggable = false;
  del.addEventListener("mousedown", (e) => e.stopPropagation());
  del.addEventListener("click", async (event) => {
    event.stopPropagation();
    await onDelete(tab.url);
  });

  li.appendChild(favicon);
  li.appendChild(text);
  li.appendChild(del);

  li.addEventListener("click", (event) => {
    if (event.target === del) return;
    focusOrOpen(tab.url);
  });

  li.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", tab.url);
    e.dataTransfer.effectAllowed = "move";
    li.classList.add("dragging");
  });
  li.addEventListener("dragend", () => li.classList.remove("dragging"));

  return li;
}

function attachDropTarget(sectionEl, targetGroupId, onDrop) {
  sectionEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    sectionEl.classList.add("drop-target");
  });
  sectionEl.addEventListener("dragleave", (e) => {
    if (e.currentTarget === sectionEl && !sectionEl.contains(e.relatedTarget)) {
      sectionEl.classList.remove("drop-target");
    }
  });
  sectionEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    sectionEl.classList.remove("drop-target");
    const url = e.dataTransfer.getData("text/plain");
    if (!url) return;
    await onDrop(url, targetGroupId);
  });
}

function buildGroupCard(cluster, tabsForList, onDelete, isUngrouped = false) {
  const wrapper = document.createElement("section");
  wrapper.className = "group";
  wrapper.dataset.groupId = isUngrouped ? UNGROUPED_ID : cluster.id;

  const head = document.createElement("div");
  head.className = "group-head";

  const badge = document.createElement("span");
  badge.className = "badge";
  const category = isUngrouped ? "other" : cluster.category;
  badge.style.background = CATEGORY_COLORS[category] || CATEGORY_COLORS.other;
  badge.textContent = isUngrouped ? "Solo" : (CATEGORY_LABELS[category] || "Other");

  const title = document.createElement("div");
  title.className = "group-title";
  title.textContent = isUngrouped ? "Ungrouped tabs" : (cluster.title || "Group");

  if (isUngrouped) {
    title.dataset.readonly = "true";
  } else {
    title.contentEditable = "true";
    title.spellcheck = false;
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        title.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        title.textContent = cluster.title || "Group";
        title.blur();
      }
    });
    title.addEventListener("blur", async () => {
      const newTitle = title.textContent.trim();
      if (newTitle && newTitle !== cluster.title) {
        await renameCluster(cluster.id, newTitle);
        cluster.title = newTitle;
      } else if (!newTitle) {
        title.textContent = cluster.title || "Group";
      }
    });
  }

  const countEl = document.createElement("span");
  countEl.className = "count";
  countEl.textContent = `${tabsForList.length} tab${tabsForList.length === 1 ? "" : "s"}`;

  head.appendChild(badge);
  head.appendChild(title);
  head.appendChild(countEl);

  if (!isUngrouped) {
    const groupDel = document.createElement("button");
    groupDel.className = "group-delete";
    groupDel.title = "Delete group (tabs go to Ungrouped)";
    groupDel.textContent = "×";
    groupDel.addEventListener("click", async () => {
      await deleteCluster(cluster.id);
      await render();
    });
    head.appendChild(groupDel);
  }

  wrapper.appendChild(head);

  const list = document.createElement("ul");
  list.className = "tabs-list";

  if (!tabsForList.length) {
    const hint = document.createElement("li");
    hint.className = "empty-group-hint";
    hint.textContent = isUngrouped
      ? "Drop tabs here to remove them from any group."
      : "Drop tabs here.";
    list.appendChild(hint);
  } else {
    for (const t of tabsForList) {
      list.appendChild(tabRow(t, onDelete));
    }
  }
  wrapper.appendChild(list);

  attachDropTarget(wrapper, isUngrouped ? UNGROUPED_ID : cluster.id, async (url, targetId) => {
    await moveTabToCluster(url, targetId);
    await render();
  });

  return wrapper;
}

async function render() {
  groupsEl.innerHTML = "";
  ungroupedEl.innerHTML = "";
  emptyEl.hidden = true;

  const [snapshot, clusters] = await Promise.all([getSnapshot(), getClusters()]);
  if (!snapshot.length && !clusters.length) {
    emptyEl.hidden = false;
    return;
  }

  const tabsByUrl = new Map(snapshot.map((t) => [t.url, t]));

  const onDelete = async (url) => {
    await deleteSavedTab(url);
    await render();
  };

  const usedUrls = new Set();
  for (const cluster of clusters) {
    const tabsForList = cluster.tabUrls.map((u) => tabsByUrl.get(u)).filter(Boolean);
    for (const t of tabsForList) usedUrls.add(t.url);
    groupsEl.appendChild(buildGroupCard(cluster, tabsForList, onDelete));
  }

  const ungroupedTabs = snapshot.filter((t) => !usedUrls.has(t.url));
  ungroupedEl.appendChild(
    buildGroupCard({ id: UNGROUPED_ID, title: "Ungrouped tabs", category: "other" }, ungroupedTabs, onDelete, true)
  );
}

async function runRefresh() {
  refreshBtn.disabled = true;
  setStatus("Adding open tabs…");

  try {
    const snapshot = await mergeOpenTabsIntoSnapshot();
    if (!snapshot.length) {
      setStatus("");
      await render();
      return;
    }

    const clusters = await getClusters();
    const groupedUrls = new Set(clusters.flatMap((c) => c.tabUrls));
    const ungrouped = snapshot.filter((t) => !groupedUrls.has(t.url));

    if (!ungrouped.length) {
      setStatus("Nothing new to cluster.");
      await render();
      return;
    }

    const apiKey = await getApiKey();
    if (apiKey) {
      setStatus(`Asking Claude where ${ungrouped.length} new tab${ungrouped.length === 1 ? "" : "s"} should go…`);
      try {
        await llmAssignIncremental(ungrouped, clusters, apiKey);
        setStatus(`Added ${ungrouped.length} new tab${ungrouped.length === 1 ? "" : "s"}.`);
      } catch (err) {
        console.error(err);
        const heuristic = heuristicCluster(ungrouped);
        await saveClusters([...clusters, ...heuristic]);
        setStatus(`Claude failed (${err.message}). Used keyword fallback.`, "error");
      }
    } else {
      const heuristic = heuristicCluster(ungrouped);
      await saveClusters([...clusters, ...heuristic]);
      setStatus("Set an API key in Settings for semantic grouping. Used keyword fallback.");
    }

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

newGroupBtn.addEventListener("click", async () => {
  const id = await createCluster("New group");
  await render();
  const titleEl = document.querySelector(`[data-group-id="${id}"] .group-title`);
  if (titleEl) {
    titleEl.focus();
    const range = document.createRange();
    range.selectNodeContents(titleEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
});

refreshBtn.addEventListener("click", runRefresh);

render();
