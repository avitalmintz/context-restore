import {
  addSingleTabToSnapshot,
  getApiKey,
  getClusters,
  getSnapshot,
  isSavableTab,
  llmAssignIncremental
} from "../shared/store.js";

const GROUPS_PAGE = "src/groups/groups.html";

const addBtn = document.getElementById("add-this");
const openBtn = document.getElementById("open-groups");
const statusEl = document.getElementById("status");
const currentEl = document.getElementById("current");
const currentTitleEl = document.getElementById("current-title");
const currentDomainEl = document.getElementById("current-domain");

function setStatus(text, isError = false) {
  statusEl.textContent = text || "";
  statusEl.className = isError ? "error" : "";
}

function safeDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function showCurrentTab() {
  const tab = await getActiveTab();
  if (!tab || !tab.url) return;
  currentEl.hidden = false;
  currentTitleEl.textContent = tab.title || tab.url;
  currentDomainEl.textContent = safeDomain(tab.url);
  if (!isSavableTab(tab)) {
    addBtn.disabled = true;
    setStatus("This tab can't be saved (chrome:// or pinned).");
  }
}

async function openGroupsPage() {
  const url = chrome.runtime.getURL(GROUPS_PAGE);
  const existing = await chrome.tabs.query({ url });
  if (existing.length) {
    const t = existing[0];
    await chrome.tabs.update(t.id, { active: true });
    if (t.windowId) await chrome.windows.update(t.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
}

async function handleAdd() {
  addBtn.disabled = true;
  setStatus("Adding…");

  const tab = await getActiveTab();
  const result = await addSingleTabToSnapshot(tab);

  if (!result.added) {
    if (result.alreadySaved) {
      setStatus("Already saved.");
    } else {
      setStatus(result.reason || "Couldn't add.", true);
    }
    addBtn.disabled = false;
    return;
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    setStatus("Saved as ungrouped. Add an API key for auto-grouping.");
    addBtn.disabled = false;
    return;
  }

  setStatus("Asking Claude where it goes…");
  try {
    const clusters = await getClusters();
    const snapshot = await getSnapshot();
    const newTab = snapshot.find((t) => t.url === result.url);
    if (newTab) {
      await llmAssignIncremental([newTab], clusters, apiKey);
    }
    setStatus("Added.");
  } catch (err) {
    console.error(err);
    setStatus(`Saved (Claude failed: ${err.message})`, true);
  } finally {
    addBtn.disabled = false;
  }
}

addBtn.addEventListener("click", handleAdd);
openBtn.addEventListener("click", openGroupsPage);

showCurrentTab();
