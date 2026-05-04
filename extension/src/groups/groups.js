import { canonicalizeUrl } from "../background/inference.js";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "../shared/constants.js";
import {
  getSnapshot,
  getClusters,
  saveClusters,
  getApiKey,
  saveApiKey,
  mergeOpenTabsIntoSnapshot,
  deleteSavedTab,
  moveTabToCluster,
  createCluster,
  deleteCluster,
  renameCluster,
  llmAssignIncremental,
  heuristicCluster
} from "../shared/store.js";

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

function setStatus(text, variant = "info") {
  statusEl.textContent = text || "";
  statusEl.className = variant === "error" ? "error" : "";
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
    await moveTabToCluster(url, targetId, UNGROUPED_ID);
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
    buildGroupCard(
      { id: UNGROUPED_ID, title: "Ungrouped tabs", category: "other" },
      ungroupedTabs,
      onDelete,
      true
    )
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
