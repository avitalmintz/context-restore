import { MESSAGE_TYPES } from "../shared/constants.js";

const overviewEl = document.getElementById("task-list");
const aiBriefingEl = document.getElementById("ai-briefing");
const detailedEl = document.getElementById("detailed-briefing");
const gapEl = document.getElementById("gap-analysis");
const emptyEl = document.getElementById("empty");
const refreshBtn = document.getElementById("refresh");
const showDoneEl = document.getElementById("show-done");
const sourceInfoEl = document.getElementById("source-info");
const modeButtons = Array.from(document.querySelectorAll(".mode-tab"));

let currentMode = "overview";
let lastTasks = [];
const KEYWORD_STOPWORDS = new Set([
  "with",
  "from",
  "that",
  "this",
  "your",
  "there",
  "their",
  "https",
  "http",
  "www",
  "com",
  "shop",
  "store",
  "page",
  "pages",
  "results",
  "result",
  "search",
  "official",
  "guide",
  "news",
  "article",
  "blog",
  "post",
  "new",
  "tab"
]);

function formatTime(ts) {
  return new Date(ts).toLocaleString();
}

function setSourceInfo(text) {
  if (!sourceInfoEl) {
    return;
  }
  sourceInfoEl.textContent = text;
}

function createEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  if (typeof text === "string") {
    el.textContent = text;
  }
  return el;
}

function safeHref(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return "#";
  }

  return "#";
}

function stateLabel(state) {
  const map = {
    read: "read",
    skimmed: "skimmed",
    unopened: "unopened",
    bounced: "closed quickly"
  };
  return map[state] || state;
}

function pageDisplayName(page) {
  const raw = page.title || page.url || "Untitled page";
  return raw.length > 110 ? `${raw.slice(0, 107)}...` : raw;
}

function taskDomainsLabel(task) {
  const domains = Array.isArray(task.domains) ? task.domains : [task.domain].filter(Boolean);
  return domains.slice(0, 4).join(", ");
}

function topPage(task) {
  return [...(task.pages || [])].sort((a, b) => {
    if (b.interestScore !== a.interestScore) {
      return b.interestScore - a.interestScore;
    }
    return b.completionScore - a.completionScore;
  })[0];
}

function hasSignal(task, pattern) {
  const text = [
    task.title,
    task.topic,
    ...(task.urls || []),
    ...((task.pages || []).map((page) => `${page.title} ${page.url}`))
  ]
    .join(" ")
    .toLowerCase();
  return pattern.test(text);
}

function getTaskGaps(task) {
  const gaps = [];
  const category = task.category || "other";

  if (task.stats.unopenedCount > 0) {
    gaps.push(`You still have ${task.stats.unopenedCount} unopened page(s).`);
  }

  if (category === "shopping") {
    const checkedReviews = hasSignal(task, /review|rating|customer\s*review|testimonials?/i);
    const checkedReturnPolicy = hasSignal(task, /return\s*policy|returns?|refund|shipping/i);

    if (!checkedReviews) {
      gaps.push("You compared options but did not check reviews.");
    }
    if (!checkedReturnPolicy) {
      gaps.push("You did not verify return policy or shipping details.");
    }
    if ((task.domains || []).length < 2) {
      gaps.push("You may want at least one more store/source for comparison.");
    }
  }

  if (category === "research") {
    if (task.stats.readCount === 0 && task.stats.skimmedCount > 0) {
      gaps.push("You skimmed sources but did not deeply read any yet.");
    }
    if ((task.domains || []).length < 2) {
      gaps.push("You have limited source diversity; consider one additional source.");
    }
  }

  if (category === "travel") {
    const checkedFlights = hasSignal(task, /flight|airline|google\s*flights|kayak|expedia/i);
    const checkedHotels = hasSignal(task, /hotel|airbnb|booking\.com|accommodation|stay/i);

    if (checkedFlights && !checkedHotels) {
      gaps.push("You looked at flights but have not researched hotels yet.");
    }
    if (!checkedFlights && checkedHotels) {
      gaps.push("You looked at stays but have not compared flight options yet.");
    }
    if (!checkedFlights && !checkedHotels) {
      gaps.push("Trip plan is incomplete: no clear flights/hotels comparison found.");
    }
  }

  if (!gaps.length && task.stats.skimmedCount > 0) {
    gaps.push("You have partially-complete reading/comparison pages to finish.");
  }

  return gaps;
}

function pageSignals(page) {
  const text = `${page.title || ""} ${page.url || ""}`.toLowerCase();
  const signals = [];

  if (/review|rating|customer\s*review|testimonial/i.test(text)) {
    signals.push("review info");
  }
  if (/price|\$|deal|sale|discount/i.test(text)) {
    signals.push("price signal");
  }
  if (/return|refund|shipping|policy/i.test(text)) {
    signals.push("policy/shipping");
  }
  if (/size|fit|spec|details?/i.test(text)) {
    signals.push("spec/details");
  }

  if (!signals.length) {
    signals.push("general page");
  }

  return signals;
}

function tokenizeForKeywords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !KEYWORD_STOPWORDS.has(token));
}

function extractTaskKeywords(task, limit = 6) {
  const counts = new Map();
  const topicTokens = tokenizeForKeywords(task.topic || "");
  const titleTokens = tokenizeForKeywords(task.title || "");
  const pageTokens = (task.pages || []).flatMap((page) =>
    tokenizeForKeywords(`${page.title || ""} ${page.url || ""}`)
  );

  for (const token of [...topicTokens, ...titleTokens, ...pageTokens]) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}

function cleanOptionLabel(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\|.*/, "")
    .replace(/-+\s*[^-]*$/, "")
    .trim();
}

function inferShoppingOptions(task) {
  const options = [];
  const seen = new Set();
  for (const page of task.pages || []) {
    const label = cleanOptionLabel(page.title || page.url || "");
    const domain = (() => {
      try {
        return new URL(page.url).hostname.replace(/^www\./, "");
      } catch {
        return "unknown source";
      }
    })();
    const key = `${domain}:${label.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    options.push({ label: label || page.url, domain, state: page.state });
  }
  return options.slice(0, 6);
}

function summarizeTaskFindings(task) {
  const category = task.category || "other";
  const keywords = extractTaskKeywords(task, 5);
  const keywordText = keywords.length ? keywords.join(", ") : "no strong keyword pattern yet";

  if (category === "shopping") {
    const options = inferShoppingOptions(task);
    const checkedReviews = hasSignal(task, /review|rating|customer\s*review|testimonials?/i);
    const checkedPolicies = hasSignal(task, /return\s*policy|returns?|refund|shipping/i);
    return [
      `Detected product/theme keywords: ${keywordText}.`,
      options.length
        ? `Compared options: ${options.map((item) => `${item.label} (${item.domain})`).join("; ")}.`
        : "No clear comparable option titles detected yet.",
      `Coverage: reviews ${checkedReviews ? "checked" : "not checked"}; return/shipping ${checkedPolicies ? "checked" : "not checked"}.`
    ];
  }

  if (category === "research") {
    const sources = [...new Set((task.pages || []).map((page) => {
      try {
        return new URL(page.url).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    }).filter(Boolean))];
    return [
      `Detected topic keywords: ${keywordText}.`,
      `Primary sources: ${sources.length ? sources.join(", ") : "none detected"}.`,
      task.stats.readCount > 0
        ? "You have at least one deeply-read source."
        : "You have not deeply read a source yet."
    ];
  }

  if (category === "travel") {
    const checkedFlights = hasSignal(task, /flight|airline|google\s*flights|kayak|expedia/i);
    const checkedHotels = hasSignal(task, /hotel|airbnb|booking\.com|accommodation|stay/i);
    return [
      `Detected travel intent keywords: ${keywordText}.`,
      `Coverage: flights ${checkedFlights ? "researched" : "not researched"}; stays ${checkedHotels ? "researched" : "not researched"}.`,
      `Pages still unfinished: ${task.stats.skimmedCount + task.stats.unopenedCount}.`
    ];
  }

  if (category === "social") {
    return [
      `Detected thread/content keywords: ${keywordText}.`,
      `Engagement pattern: ${task.stats.bouncedCount} closed quickly, ${task.stats.skimmedCount} skimmed, ${task.stats.readCount} deeply read.`,
      "If this was distraction rather than intent, mark done or delete context."
    ];
  }

  return [
    `Detected task keywords: ${keywordText}.`,
    `Engagement pattern: read ${task.stats.readCount}, skimmed ${task.stats.skimmedCount}, unopened ${task.stats.unopenedCount}, closed quickly ${task.stats.bouncedCount}.`,
    "Rename this task to sharpen future grouping quality."
  ];
}

function createPagePreviewItem(page) {
  const item = createEl("li");
  const state = createEl("span", "pill", stateLabel(page.state));
  const link = createEl("a", null, pageDisplayName(page));
  link.href = safeHref(page.url);
  link.target = "_blank";
  link.rel = "noreferrer";

  item.appendChild(state);
  item.appendChild(link);
  return item;
}

function createTaskCard(task, onMutate) {
  const card = createEl("article", "card");
  card.dataset.taskId = task.taskId;

  card.appendChild(createEl("h2", null, task.title));
  card.appendChild(
    createEl(
      "div",
      "meta",
      `${task.stats.pageCount} pages • confidence ${Math.round(task.confidence * 100)}% • last activity ${formatTime(
        task.lastActivityTs
      )} • status ${task.status}`
    )
  );
  card.appendChild(createEl("p", "brief", task.briefing));
  card.appendChild(createEl("p", "meta", `Next action: ${task.nextAction}`));
  card.appendChild(
    createEl(
      "p",
      "meta",
      `Read ${task.stats.readCount} • Skimmed ${task.stats.skimmedCount} • Unopened ${task.stats.unopenedCount} • Closed quickly ${task.stats.bouncedCount}`
    )
  );

  const list = createEl("ul", "urls");
  for (const page of task.pages.slice(0, 4)) {
    list.appendChild(createPagePreviewItem(page));
  }
  card.appendChild(list);

  const ctaRow = createEl("div", "cta-row");

  const resumeBtn = createEl("button", "resume", "Resume Task");
  resumeBtn.addEventListener("click", async () => {
    const urls = Array.isArray(task.urls) && task.urls.length
      ? task.urls
      : (task.pages || []).map((page) => page.url).filter(Boolean);
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.RESUME_TASK,
      taskId: task.taskId,
      urls
    });
  });

  const renameBtn = createEl("button", "rename", "Rename");
  renameBtn.addEventListener("click", async () => {
    const nextTitle = window.prompt("Rename task", task.title);
    if (nextTitle === null) {
      return;
    }

    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.RENAME_TASK,
      taskId: task.taskId,
      title: nextTitle.trim()
    });
    await onMutate();
  });

  const doneBtn = createEl("button", "done", task.status === "done" ? "Reopen Task" : "Mark Done");
  doneBtn.addEventListener("click", async () => {
    const done = task.status !== "done";
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SET_TASK_DONE,
      taskId: task.taskId,
      done
    });
    await onMutate();
  });

  const deleteBtn = createEl("button", "delete", "Delete Task Context");
  deleteBtn.addEventListener("click", async () => {
    const confirmed = window.confirm(
      "Delete this task context? This removes its stored browsing events from local history."
    );
    if (!confirmed) {
      return;
    }

    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.DELETE_TASK,
      taskId: task.taskId,
      urls: task.urls
    });
    await onMutate();
  });

  ctaRow.appendChild(resumeBtn);
  ctaRow.appendChild(renameBtn);
  ctaRow.appendChild(doneBtn);
  ctaRow.appendChild(deleteBtn);
  card.appendChild(ctaRow);

  return card;
}

function createAiBriefCard(task) {
  const card = createEl("article", "summary-card");
  const heading = createEl("h3", null, task.title);
  const category = (task.category || "task").toLowerCase();
  const main = createEl("p");

  const top = topPage(task);
  const topLabel = top ? pageDisplayName(top) : "no dominant page";
  const topInterest = top ? `${Math.round(top.interestScore)}%` : "n/a";

  if (category === "shopping") {
    main.textContent = `You were comparing ${task.stats.pageCount} shopping pages across ${taskDomainsLabel(
      task
    )}. You seemed most interested in "${topLabel}" (${topInterest} interest).`;
  } else if (category === "research") {
    main.textContent = `You were exploring ${task.stats.pageCount} sources on ${task.topic || "one topic"}. Your strongest engagement was "${topLabel}".`;
  } else if (category === "travel") {
    main.textContent = `You were planning travel across ${task.stats.pageCount} pages. Most engagement centered on "${topLabel}".`;
  } else {
    main.textContent = `You were working across ${task.stats.pageCount} related pages. Highest engagement was "${topLabel}".`;
  }

  const gapLines = getTaskGaps(task);
  const gap = createEl("p", null, gapLines[0] ? `Potential miss: ${gapLines[0]}` : "No major gap detected yet.");
  const findings = summarizeTaskFindings(task);
  const finding = createEl("p", null, findings[0] || "");

  card.appendChild(heading);
  card.appendChild(createEl("p", "meta", `${task.stats.pageCount} pages • ${Math.round(task.confidence * 100)}% confidence`));
  card.appendChild(main);
  card.appendChild(finding);
  card.appendChild(gap);

  return card;
}

function createDetailedCard(task) {
  const card = createEl("article", "summary-card");
  card.appendChild(createEl("h3", null, task.title));
  card.appendChild(
    createEl(
      "p",
      "meta",
      `${task.stats.pageCount} pages • domains: ${taskDomainsLabel(task)} • last active ${formatTime(task.lastActivityTs)}`
    )
  );

  const behavior = createEl(
    "p",
    null,
    `Behavior summary: read ${task.stats.readCount}, skimmed ${task.stats.skimmedCount}, unopened ${task.stats.unopenedCount}, closed quickly ${task.stats.bouncedCount}.`
  );
  card.appendChild(behavior);

  const findings = summarizeTaskFindings(task);
  if (findings.length) {
    const findingList = createEl("ul", "summary-list");
    for (const line of findings) {
      findingList.appendChild(createEl("li", null, line));
    }
    card.appendChild(findingList);
  }

  const pageList = createEl("ul", "summary-list");
  for (const page of task.pages.slice(0, 8)) {
    const li = createEl("li");
    const label = `${stateLabel(page.state)} • ${pageDisplayName(page)} • interest ${Math.round(
      page.interestScore
    )}% • completion ${Math.round(page.completionScore)}% • signals: ${pageSignals(page).join(", "
    )}`;
    li.textContent = label;
    pageList.appendChild(li);
  }
  card.appendChild(pageList);

  const gaps = getTaskGaps(task);
  if (gaps.length) {
    const gapList = createEl("ul", "summary-list");
    for (const line of gaps) {
      gapList.appendChild(createEl("li", null, `Next: ${line}`));
    }
    card.appendChild(gapList);
  }

  return card;
}

function renderOverview(tasks) {
  overviewEl.innerHTML = "";
  for (const task of tasks) {
    overviewEl.appendChild(createTaskCard(task, loadFeed));
  }

  const hash = window.location.hash || "";
  const match = hash.match(/task=([^&]+)/);
  if (match) {
    const taskId = decodeURIComponent(match[1]);
    const target = overviewEl.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.style.outline = "2px solid #1b6f4a";
      target.style.outlineOffset = "2px";
      setTimeout(() => {
        target.style.outline = "";
        target.style.outlineOffset = "";
      }, 2200);
    }
  }
}

function renderAiBriefing(tasks) {
  aiBriefingEl.innerHTML = "";
  const note = createEl(
    "div",
    "ai-note",
    "AI Briefing uses browsing behavior + page metadata (title/URL), not full page content."
  );
  aiBriefingEl.appendChild(note);

  for (const task of tasks) {
    aiBriefingEl.appendChild(createAiBriefCard(task));
  }
}

function renderDetailedBriefing(tasks) {
  detailedEl.innerHTML = "";
  const note = createEl(
    "div",
    "ai-note",
    "Detailed Briefs are task-by-task diagnostics with page-level signals and suggested next checks."
  );
  detailedEl.appendChild(note);

  for (const task of tasks) {
    detailedEl.appendChild(createDetailedCard(task));
  }
}

function renderGapAnalysis(tasks) {
  gapEl.innerHTML = "";
  const note = createEl(
    "div",
    "ai-note",
    "Gap Analysis highlights likely blind spots based on your behavior across each task."
  );
  gapEl.appendChild(note);

  const allGaps = [];
  for (const task of tasks) {
    const gaps = getTaskGaps(task);
    for (const gap of gaps) {
      allGaps.push({ taskTitle: task.title, text: gap });
    }
  }

  if (!allGaps.length) {
    gapEl.appendChild(createEl("article", "summary-card", "No major gaps detected yet."));
    return;
  }

  for (const item of allGaps) {
    const div = createEl("article", "gap-item");
    div.appendChild(createEl("strong", null, item.taskTitle));
    div.appendChild(createEl("p", null, item.text));
    gapEl.appendChild(div);
  }
}

function setMode(mode) {
  currentMode = mode;

  const panels = {
    overview: overviewEl,
    ai: aiBriefingEl,
    detailed: detailedEl,
    gaps: gapEl
  };

  for (const [name, panel] of Object.entries(panels)) {
    panel.hidden = name !== currentMode;
  }

  for (const button of modeButtons) {
    const active = button.dataset.mode === currentMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }

  if (!lastTasks.length) {
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;
  if (currentMode === "overview") {
    renderOverview(lastTasks);
  } else if (currentMode === "ai") {
    renderAiBriefing(lastTasks);
  } else if (currentMode === "detailed") {
    renderDetailedBriefing(lastTasks);
  } else if (currentMode === "gaps") {
    renderGapAnalysis(lastTasks);
  }
}

async function loadFeed() {
  const includeDone = showDoneEl.checked;
  let usedCloud = false;
  let cloudError = "";

  const settingsResponse = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.GET_SETTINGS
  });
  const syncSettings = settingsResponse?.ok ? settingsResponse?.settings?.syncSettings || {} : {};
  const canUseCloud = Boolean(syncSettings.enabled && syncSettings.backendUrl && syncSettings.apiToken);

  if (canUseCloud) {
    const remoteResponse = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GET_REMOTE_TASK_FEED,
      filters: { limit: 50, includeDone },
      syncFirst: true
    });
    if (remoteResponse?.ok) {
      lastTasks = remoteResponse.tasks || [];
      usedCloud = true;
      const serverText = remoteResponse.serverTs ? formatTime(remoteResponse.serverTs) : "unknown";
      const syncText = remoteResponse.syncError ? `sync warning: ${remoteResponse.syncError}` : "sync ok";
      setSourceInfo(`Source: cloud (matches iPhone) • server ${serverText} • ${syncText}`);
    } else {
      cloudError = remoteResponse?.error || "Cloud load failed";
    }
  }

  if (!usedCloud) {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GET_TASK_FEED,
      filters: { limit: 50, includeDone }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not load task feed");
    }
    lastTasks = response.tasks || [];
    setSourceInfo(cloudError ? `Source: local fallback • ${cloudError}` : "Source: local");
  }

  overviewEl.innerHTML = "";
  aiBriefingEl.innerHTML = "";
  detailedEl.innerHTML = "";
  gapEl.innerHTML = "";

  setMode(currentMode);
}

refreshBtn.addEventListener("click", () => {
  loadFeed().catch((error) => {
    overviewEl.innerHTML = `<article class="card">${error.message}</article>`;
    aiBriefingEl.innerHTML = "";
    detailedEl.innerHTML = "";
    gapEl.innerHTML = "";
  });
});

showDoneEl.addEventListener("change", () => {
  loadFeed().catch((error) => {
    overviewEl.innerHTML = `<article class="card">${error.message}</article>`;
  });
});

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode || "overview");
  });
}

loadFeed().catch((error) => {
  overviewEl.innerHTML = `<article class="card">${error.message}</article>`;
});
