const GROUPS_PAGE = "src/groups/groups.html";

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL(GROUPS_PAGE);
  const existing = await chrome.tabs.query({ url });
  if (existing.length) {
    const tab = existing[0];
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url });
});
