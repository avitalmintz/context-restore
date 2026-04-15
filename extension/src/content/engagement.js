(() => {
  if (window.top !== window) {
    return;
  }

  const SNAPSHOT_INTERVAL_MS = 4000;
  const INTERACTION_THROTTLE_MS = 1200;
  let lastTs = Date.now();
  let lastInteractionSnapshotTs = 0;

  function getScrollPct() {
    const doc = document.documentElement;
    const maxScrollable = Math.max(doc.scrollHeight - window.innerHeight, 1);
    const current = Math.min(window.scrollY, maxScrollable);
    return Number(((current / maxScrollable) * 100).toFixed(1));
  }

  function sendSnapshot(reason = "interval") {
    const now = Date.now();
    const active = !document.hidden && document.hasFocus();
    const activeMsSinceLast = active ? now - lastTs : 0;

    chrome.runtime.sendMessage({
      type: "ENGAGEMENT_SNAPSHOT",
      url: location.href,
      metrics: {
        reason,
        scrollPct: getScrollPct(),
        visible: !document.hidden,
        focused: document.hasFocus(),
        activeMsSinceLast,
        ts: now
      }
    });

    lastTs = now;
  }

  function maybeSendInteractionSnapshot(reason) {
    const now = Date.now();
    if (now - lastInteractionSnapshotTs < INTERACTION_THROTTLE_MS) {
      return;
    }

    lastInteractionSnapshotTs = now;
    sendSnapshot(reason);
  }

  sendSnapshot("init");

  const intervalId = setInterval(() => {
    sendSnapshot("interval");
  }, SNAPSHOT_INTERVAL_MS);

  window.addEventListener(
    "scroll",
    () => {
      maybeSendInteractionSnapshot("scroll");
    },
    { passive: true }
  );

  window.addEventListener("click", () => {
    maybeSendInteractionSnapshot("click");
  });

  window.addEventListener("keydown", () => {
    maybeSendInteractionSnapshot("keydown");
  });

  document.addEventListener("visibilitychange", () => {
    sendSnapshot("visibilitychange");
  });

  window.addEventListener("beforeunload", () => {
    sendSnapshot("beforeunload");
    clearInterval(intervalId);
  });
})();
