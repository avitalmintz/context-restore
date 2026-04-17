import { MESSAGE_TYPES } from "../shared/constants.js";

const overviewEl = document.getElementById("task-list");
const dailyEl = document.getElementById("daily-summary");
const detailedEl = document.getElementById("detailed-briefing");
const emptyEl = document.getElementById("empty");
const refreshBtn = document.getElementById("refresh");
const showDoneEl = document.getElementById("show-done");
const sourceInfoEl = document.getElementById("source-info");
const modeButtons = Array.from(document.querySelectorAll(".mode-tab"));

let currentMode = "overview";
let lastTasks = [];
let lastDailySummaries = [];
let lastTaskRelations = {
  mergedIntoByTaskId: {},
  keepSeparatePairs: {},
  mergeRules: [],
  keepSeparateRules: []
};
let lastResolvedKeepSeparatePairs = {};
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

function formatDayKey(key) {
  const [y, m, d] = String(key || "").split("-");
  if (!y || !m || !d) return key;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatDurationLong(ms) {
  const totalMin = Math.max(0, Math.round(Number(ms || 0) / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
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

function statusLabel(task) {
  const workflow = String(task.workflowState || "").trim();
  if (task.status === "done") return "completed";
  if (task.status === "dropped") return "dropped";
  if (task.status === "snoozed") {
    if (task.snoozedUntilTs) {
      return `snoozed until ${formatTime(task.snoozedUntilTs)}`;
    }
    return "snoozed";
  }
  return workflow || "active";
}

function formatDuration(activeMs) {
  const mins = Math.max(1, Math.round(Number(activeMs || 0) / 60_000));
  return `${mins} min`;
}

function clampNum(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function pageReadingProgressPct(page) {
  const explicit = Number(page.readingProgressPct);
  if (Number.isFinite(explicit) && explicit >= 0) {
    return clampNum(explicit, 0, 100);
  }
  const inferred = Math.max(Number(page.completionScore || 0), Number(page.maxScrollPct || 0) * 0.85);
  return clampNum(inferred, 0, 100);
}

function pageMinutesLeft(page) {
  const explicitMs = Number(page.remainingReadMs);
  if (Number.isFinite(explicitMs) && explicitMs >= 0) {
    return Math.max(0, Math.round(explicitMs / 60_000));
  }

  const progress = pageReadingProgressPct(page);
  if (progress >= 97) {
    return 0;
  }

  const activeMs = Math.max(0, Number(page.activeMs || 0));
  if (progress >= 8 && activeMs >= 10_000) {
    const totalEstimateMs = activeMs / (progress / 100);
    return Math.max(0, Math.round((totalEstimateMs - activeMs) / 60_000));
  }

  return page.state === "read" ? 0 : 3;
}

function taskProgressSummary(task) {
  const pages = task.pages || [];
  if (!pages.length) {
    return { progressPct: 0, minutesLeft: 0 };
  }

  const progressPct = Math.round(
    pages.reduce((sum, page) => sum + pageReadingProgressPct(page), 0) / pages.length
  );
  const minutesLeft = pages.reduce((sum, page) => sum + pageMinutesLeft(page), 0);
  return { progressPct, minutesLeft };
}

function relativeAge(ts) {
  const deltaMs = Date.now() - Number(ts || 0);
  if (!Number.isFinite(deltaMs) || deltaMs < 60_000) {
    return "just now";
  }
  const mins = Math.floor(deltaMs / 60_000);
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function toLocalInputValue(ts) {
  const date = new Date(ts);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function parseRemindAtPrompt(defaultTs) {
  const input = window.prompt(
    "Remind when? Use local date/time format: YYYY-MM-DDTHH:MM",
    toLocalInputValue(defaultTs)
  );

  if (input === null) {
    return null;
  }

  const parsed = Date.parse(input.trim());
  if (!Number.isFinite(parsed)) {
    throw new Error("Invalid date/time. Use format YYYY-MM-DDTHH:MM.");
  }
  if (parsed <= Date.now() + 30_000) {
    throw new Error("Reminder time must be in the future.");
  }
  return parsed;
}

function safeTaskTitle(task) {
  return task.title || "Untitled task";
}

function orderedResumeUrls(task) {
  if (Array.isArray(task.resumePlan?.orderedUrls) && task.resumePlan.orderedUrls.length) {
    return task.resumePlan.orderedUrls;
  }
  if (Array.isArray(task.pages) && task.pages.length) {
    const pageUrls = task.pages.map((page) => page.url).filter(Boolean);
    if (pageUrls.length) {
      return pageUrls;
    }
  }
  return Array.isArray(task.urls) ? task.urls : [];
}

function promptSelectFromList(title, items, defaultIndex = 1) {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }

  const lines = items.map((item, index) => `${index + 1}. ${item.label}`);
  const input = window.prompt(`${title}\n\n${lines.join("\n")}`, String(defaultIndex));
  if (input === null) {
    return null;
  }

  const selection = Number(input.trim());
  if (!Number.isInteger(selection) || selection < 1 || selection > items.length) {
    throw new Error("Invalid selection.");
  }

  return items[selection - 1].value;
}

async function sendMessageOrThrow(payload, fallbackPayload = null) {
  let response = null;
  try {
    response = await chrome.runtime.sendMessage(payload);
  } catch (error) {
    if (!fallbackPayload) {
      throw error;
    }
    response = await chrome.runtime.sendMessage(fallbackPayload);
  }

  if (!response?.ok && fallbackPayload) {
    const fallbackResponse = await chrome.runtime.sendMessage(fallbackPayload);
    if (!fallbackResponse?.ok) {
      throw new Error(fallbackResponse?.error || response?.error || "Action failed");
    }
    return fallbackResponse;
  }

  if (!response?.ok) {
    throw new Error(response?.error || "Action failed");
  }

  return response;
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

  for (const signal of task.decisionContext?.missingSignals || []) {
    if (!gaps.includes(signal)) {
      gaps.push(signal);
    }
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
    const checkedReviews =
      task.adapter?.checks?.reviews ??
      hasSignal(task, /review|rating|customer\s*review|testimonials?/i);
    const checkedPolicies =
      task.adapter?.checks?.returnPolicy ??
      hasSignal(task, /return\s*policy|returns?|refund|shipping/i);
    const checkedPrice =
      task.adapter?.checks?.price ??
      hasSignal(task, /\$|price|deal|discount|sale|under\s+\d+/i);
    const adapterOptions = Array.isArray(task.adapter?.options) ? task.adapter.options : [];
    const optionLine = adapterOptions.length
      ? `Shortlist signals: ${adapterOptions
        .map((item) => `${item.title || "option"} (${item.domain})`)
        .join("; ")}.`
      : options.length
        ? `Compared options: ${options.map((item) => `${item.label} (${item.domain})`).join("; ")}.`
        : "No clear comparable option titles detected yet.";
    return [
      `Detected product/theme keywords: ${keywordText}.`,
      optionLine,
      `Coverage: reviews ${checkedReviews ? "checked" : "not checked"}; return/shipping ${checkedPolicies ? "checked" : "not checked"}; price ${checkedPrice ? "checked" : "not checked"}.`
    ];
  }

  if (category === "job") {
    const roleSignals =
      task.adapter?.checks?.roleRequirements ??
      hasSignal(task, /requirements|qualification|experience|responsibilit/i);
    const compSignals =
      task.adapter?.checks?.compensation ??
      hasSignal(task, /salary|compensation|pay|benefits/i);
    const appSignals =
      task.adapter?.checks?.application ??
      hasSignal(task, /apply|application|submit/i);
    return [
      `Detected job-search keywords: ${keywordText}.`,
      `Coverage: role requirements ${roleSignals ? "checked" : "not checked"}; compensation ${compSignals ? "checked" : "not checked"}; application path ${appSignals ? "checked" : "not checked"}.`,
      `Pages still unfinished: ${task.stats.skimmedCount + task.stats.unopenedCount}.`
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
    const checkedFlights =
      task.adapter?.checks?.flights ??
      hasSignal(task, /flight|airline|google\s*flights|kayak|expedia/i);
    const checkedHotels =
      task.adapter?.checks?.hotels ??
      hasSignal(task, /hotel|airbnb|booking\.com|accommodation|stay/i);
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

function totalActiveMs(task) {
  const direct = Number(task?.stats?.activeMs || 0);
  if (direct > 0) {
    return direct;
  }
  return (task.pages || []).reduce((sum, page) => sum + Number(page?.activeMs || 0), 0);
}

function intentScore(task) {
  const activeMs = totalActiveMs(task);
  const revisits = Number(task?.stats?.revisitCount || 0);
  const reads = Number(task?.stats?.readCount || 0);
  const pages = Number(task?.stats?.pageCount || task?.pages?.length || 0);
  const topInterest = Number(topPage(task)?.interestScore || 0);
  const score =
    Math.min(45, activeMs / 60_000 * 4) +
    Math.min(20, revisits * 5) +
    Math.min(20, reads * 8) +
    Math.min(10, pages * 2) +
    Math.min(5, topInterest / 20);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function intentLabel(task) {
  const score = intentScore(task);
  if (score >= 70) return "High intent";
  if (score >= 40) return "Medium intent";
  return "Low intent";
}

function objectiveLabel(task) {
  const topic = String(task.topic || "").trim();
  if (task.category === "shopping") {
    return topic ? `Compare and decide on ${topic}` : "Compare products and decide";
  }
  if (task.category === "research") {
    return topic ? `Understand ${topic}` : "Understand topic quickly";
  }
  if (task.category === "travel") {
    return topic ? `Plan ${topic} travel` : "Plan trip details";
  }
  if (task.category === "job") {
    return topic ? `Evaluate ${topic} opportunities` : "Evaluate job opportunities";
  }
  if (task.category === "social") {
    return topic ? `Catch up on ${topic}` : "Catch up on thread";
  }
  return topic ? `Continue ${topic}` : "Continue this browsing thread";
}

function nextBestPage(task) {
  const pages = [...(task.pages || [])];
  if (!pages.length) {
    return null;
  }
  pages.sort((a, b) => {
    const stateDelta = (a.state === "unopened" ? 0 : a.state === "skimmed" ? 1 : 2) -
      (b.state === "unopened" ? 0 : b.state === "skimmed" ? 1 : 2);
    if (stateDelta !== 0) return stateDelta;
    if (b.interestScore !== a.interestScore) return b.interestScore - a.interestScore;
    return Number(b.lastTs || 0) - Number(a.lastTs || 0);
  });
  return pages[0];
}

function closureHint(task) {
  const activeMs = totalActiveMs(task);
  if (
    Number(task.stats?.pageCount || 0) <= 1 &&
    activeMs < 2 * 60_000 &&
    Number(task.stats?.readCount || 0) === 0
  ) {
    return "This looks like a quick detour. You can mark done or delete if it is no longer relevant.";
  }
  if (Number(task.stats?.skimmedCount || 0) === 0 && Number(task.stats?.unopenedCount || 0) === 0) {
    return "You reviewed all tracked pages. Mark done if no decision remains.";
  }
  return "Keep this open only if you still have a real decision to make.";
}

function buildActionPlan(task) {
  const plan = [];
  const bestPage = nextBestPage(task);
  if (bestPage) {
    plan.push(`Open "${pageDisplayName(bestPage)}" next and finish it end-to-end.`);
  }
  const gaps = getTaskGaps(task);
  if (gaps.length) {
    plan.push(gaps[0]);
  } else if (task.category === "shopping") {
    plan.push("Shortlist top 2 options and decide now.");
  } else if (task.category === "research") {
    plan.push("Extract one key takeaway and close the task.");
  } else {
    plan.push("Resolve the top open page, then close this task.");
  }
  plan.push(closureHint(task));
  return plan.slice(0, 3);
}

function taskTokenSet(task) {
  return new Set(extractTaskKeywords(task, 10));
}

function overlapRatio(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let common = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      common += 1;
    }
  }
  return common / Math.max(setA.size, setB.size);
}

function buildOverlapMap(tasks) {
  const map = new Map();
  const tokenSets = new Map(tasks.map((task) => [task.taskId, taskTokenSet(task)]));
  for (const task of tasks) {
    const domainsA = new Set([...(task.domains || []), task.domain].filter(Boolean));
    const overlaps = [];
    for (const other of tasks) {
      if (task.taskId === other.taskId) continue;
      const domainsB = new Set([...(other.domains || []), other.domain].filter(Boolean));
      let sharedDomain = 0;
      for (const domain of domainsA) {
        if (domainsB.has(domain)) sharedDomain += 1;
      }
      const tokenOverlap = overlapRatio(tokenSets.get(task.taskId) || new Set(), tokenSets.get(other.taskId) || new Set());
      const score = tokenOverlap + (sharedDomain > 0 ? 0.25 : 0);
      if (score >= 0.45) {
        overlaps.push(other.title);
      }
    }
    map.set(task.taskId, overlaps.slice(0, 2));
  }
  return map;
}

function normalizeTaskRelations(raw) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const mergedIntoByTaskId =
    safe.mergedIntoByTaskId && typeof safe.mergedIntoByTaskId === "object"
      ? { ...safe.mergedIntoByTaskId }
      : {};
  const keepSeparatePairs =
    safe.keepSeparatePairs && typeof safe.keepSeparatePairs === "object"
      ? { ...safe.keepSeparatePairs }
      : {};
  const mergeRules = Array.isArray(safe.mergeRules) ? safe.mergeRules.filter(Boolean) : [];
  const keepSeparateRules = Array.isArray(safe.keepSeparateRules)
    ? safe.keepSeparateRules.filter(Boolean)
    : [];
  return { mergedIntoByTaskId, keepSeparatePairs, mergeRules, keepSeparateRules };
}

function relationTokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !KEYWORD_STOPWORDS.has(token));
}

function canonicalRelationUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }
    parsed.hash = "";
    parsed.hostname = parsed.hostname.replace(/^www\./, "");
    parsed.search = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch {
    return "";
  }
}

function taskRelationSnapshot(task) {
  if (!task || typeof task !== "object") {
    return null;
  }

  const urls = [...new Set(
    [
      ...(task.urls || []),
      ...((task.pages || []).map((page) => page.url))
    ]
      .map((url) => canonicalRelationUrl(url))
      .filter(Boolean)
  )].slice(0, 12);

  const tokens = [...new Set(relationTokens([
    task.title,
    task.topic,
    ...urls
  ].join(" ")))].slice(0, 14);

  return {
    taskId: String(task.taskId || "").trim(),
    title: String(task.title || ""),
    topic: String(task.topic || ""),
    domain: String(task.domain || ""),
    domains: [...new Set((task.domains || []).map((domain) => String(domain || "").trim().toLowerCase()).filter(Boolean))],
    urls,
    tokens
  };
}

function normalizeRelationSnapshot(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const urls = [...new Set((raw.urls || [])
    .map((url) => canonicalRelationUrl(url))
    .filter(Boolean))]
    .slice(0, 12);
  const tokens = [...new Set((Array.isArray(raw.tokens) ? raw.tokens : relationTokens([
    raw.title,
    raw.topic,
    ...urls
  ].join(" ")))
    .map((token) => String(token || "").trim().toLowerCase())
    .filter(Boolean))]
    .slice(0, 14);
  const domains = [...new Set((raw.domains || [])
    .map((domain) => String(domain || "").trim().toLowerCase())
    .filter(Boolean))]
    .slice(0, 8);
  const taskId = String(raw.taskId || "").trim();

  if (!taskId && !urls.length && !tokens.length && !domains.length && !raw.domain) {
    return null;
  }

  return {
    taskId,
    title: String(raw.title || ""),
    topic: String(raw.topic || ""),
    domain: String(raw.domain || "").trim().toLowerCase(),
    domains,
    urls,
    tokens
  };
}

function relationOverlapRatio(listA, listB) {
  if (!listA.length || !listB.length) {
    return 0;
  }
  const setA = new Set(listA);
  const setB = new Set(listB);
  let common = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      common += 1;
    }
  }
  return common / Math.max(setA.size, setB.size);
}

function taskMatchScore(snapshot, task) {
  if (!snapshot || !task) {
    return 0;
  }
  const taskSnapshot = taskRelationSnapshot(task);
  if (!taskSnapshot) {
    return 0;
  }

  const domainA = new Set([snapshot.domain, ...(snapshot.domains || [])].filter(Boolean));
  const domainB = new Set([taskSnapshot.domain, ...(taskSnapshot.domains || [])].filter(Boolean));
  let sharedDomains = 0;
  for (const domain of domainA) {
    if (domainB.has(domain)) {
      sharedDomains += 1;
    }
  }
  const urlOverlap = relationOverlapRatio(snapshot.urls || [], taskSnapshot.urls || []);
  const tokenOverlap = relationOverlapRatio(snapshot.tokens || [], taskSnapshot.tokens || []);
  return urlOverlap + tokenOverlap + (sharedDomains > 0 ? 0.3 : 0);
}

function findTaskIdForSnapshot(snapshot, tasks, usedTaskIds = new Set()) {
  const normalized = normalizeRelationSnapshot(snapshot);
  if (!normalized) {
    return "";
  }

  if (normalized.taskId) {
    const exact = tasks.find((task) => task.taskId === normalized.taskId);
    if (exact && !usedTaskIds.has(exact.taskId)) {
      return exact.taskId;
    }
  }

  let bestTaskId = "";
  let bestScore = 0;
  for (const task of tasks) {
    if (usedTaskIds.has(task.taskId)) {
      continue;
    }
    const score = taskMatchScore(normalized, task);
    if (score > bestScore) {
      bestTaskId = task.taskId;
      bestScore = score;
    }
  }

  if (bestScore < 0.4) {
    return "";
  }
  return bestTaskId;
}

function resolveRelationMaps(tasks, relations) {
  const normalized = normalizeTaskRelations(relations);
  const mergedIntoByTaskId = { ...(normalized.mergedIntoByTaskId || {}) };
  const keepSeparatePairs = { ...(normalized.keepSeparatePairs || {}) };

  for (const rule of normalized.mergeRules || []) {
    const used = new Set();
    const primaryTaskId = findTaskIdForSnapshot(rule.primarySnapshot || { taskId: rule.primaryTaskId }, tasks, used)
      || String(rule.primaryTaskId || "").trim();
    if (primaryTaskId) {
      used.add(primaryTaskId);
    }
    const secondaryTaskId = findTaskIdForSnapshot(
      rule.secondarySnapshot || { taskId: rule.secondaryTaskId },
      tasks,
      used
    ) || String(rule.secondaryTaskId || "").trim();
    if (!primaryTaskId || !secondaryTaskId || primaryTaskId === secondaryTaskId) {
      continue;
    }
    mergedIntoByTaskId[secondaryTaskId] = primaryTaskId;
    delete keepSeparatePairs[taskPairKey(primaryTaskId, secondaryTaskId)];
  }

  for (const rule of normalized.keepSeparateRules || []) {
    const used = new Set();
    const primaryTaskId = findTaskIdForSnapshot(rule.primarySnapshot || { taskId: rule.primaryTaskId }, tasks, used)
      || String(rule.primaryTaskId || "").trim();
    if (primaryTaskId) {
      used.add(primaryTaskId);
    }
    const secondaryTaskId = findTaskIdForSnapshot(
      rule.secondarySnapshot || { taskId: rule.secondaryTaskId },
      tasks,
      used
    ) || String(rule.secondaryTaskId || "").trim();
    if (!primaryTaskId || !secondaryTaskId || primaryTaskId === secondaryTaskId) {
      continue;
    }
    keepSeparatePairs[taskPairKey(primaryTaskId, secondaryTaskId)] = Number(rule.createdAt || Date.now());
  }

  return { mergedIntoByTaskId, keepSeparatePairs };
}

function taskPairKey(a, b) {
  return [String(a || "").trim(), String(b || "").trim()].sort().join("::");
}

function dedupePages(pages) {
  const byUrl = new Map();
  for (const page of pages || []) {
    const key = String(page?.url || "").trim();
    if (!key) continue;
    const current = byUrl.get(key);
    if (!current) {
      byUrl.set(key, { ...page });
      continue;
    }
    const currentScore = Number(current.interestScore || 0) + Number(current.completionScore || 0);
    const nextScore = Number(page.interestScore || 0) + Number(page.completionScore || 0);
    if (nextScore > currentScore) {
      byUrl.set(key, { ...page });
    }
  }

  return [...byUrl.values()].sort((a, b) => {
    if (Number(b.interestScore || 0) !== Number(a.interestScore || 0)) {
      return Number(b.interestScore || 0) - Number(a.interestScore || 0);
    }
    return Number(b.lastTs || 0) - Number(a.lastTs || 0);
  });
}

function statsFromPages(pages, baseStats = {}, extraStats = null) {
  const safePages = pages || [];
  const counts = { read: 0, skimmed: 0, unopened: 0, bounced: 0 };
  let activeMs = 0;
  let revisitCount = 0;
  let deepScrollCount = 0;

  for (const page of safePages) {
    const state = String(page.state || "skimmed");
    if (counts[state] !== undefined) {
      counts[state] += 1;
    }
    activeMs += Number(page.activeMs || 0);
    revisitCount += Number(page.revisitCount || 0);
    if (Number(page.maxScrollPct || 0) >= 80) {
      deepScrollCount += 1;
    }
  }

  return {
    ...baseStats,
    ...(extraStats || {}),
    activeMs,
    pageCount: safePages.length,
    readCount: counts.read,
    skimmedCount: counts.skimmed,
    unopenedCount: counts.unopened,
    bouncedCount: counts.bounced,
    revisitCount,
    deepScrollCount
  };
}

function mergeTaskRecords(primary, secondary) {
  const pages = dedupePages([...(primary.pages || []), ...(secondary.pages || [])]);
  const domains = [...new Set([...(primary.domains || []), ...(secondary.domains || []), primary.domain, secondary.domain].filter(Boolean))];
  const relatedTasks = [...(primary.relatedTasks || []), ...(secondary.relatedTasks || [])];
  const relatedByTaskId = new Map();
  for (const related of relatedTasks) {
    const id = String(related?.taskId || "").trim();
    if (!id || id === primary.taskId || id === secondary.taskId) {
      continue;
    }
    const score = Number(related?.overlapScore || 0);
    const current = relatedByTaskId.get(id);
    if (!current || Number(current.overlapScore || 0) < score) {
      relatedByTaskId.set(id, related);
    }
  }
  const mergedFromTaskIds = [
    ...(primary.mergedFromTaskIds || []),
    secondary.taskId,
    ...(secondary.mergedFromTaskIds || [])
  ];
  const mergedFromTitles = [
    ...(primary.mergedFromTitles || []),
    secondary.title,
    ...(secondary.mergedFromTitles || [])
  ];

  return {
    ...primary,
    domain: primary.domain || secondary.domain,
    domains,
    pages,
    urls: pages.map((page) => page.url).filter(Boolean),
    stats: statsFromPages(pages, primary.stats, {
      eventCount: Number(primary.stats?.eventCount || 0) + Number(secondary.stats?.eventCount || 0)
    }),
    lastActivityTs: Math.max(Number(primary.lastActivityTs || 0), Number(secondary.lastActivityTs || 0)),
    confidence: Math.max(Number(primary.confidence || 0), Number(secondary.confidence || 0)),
    topic: primary.topic || secondary.topic,
    nextAction: primary.nextAction || secondary.nextAction,
    relatedTasks: [...relatedByTaskId.values()]
      .sort((a, b) => Number(b.overlapScore || 0) - Number(a.overlapScore || 0))
      .slice(0, 2),
    mergedFromTaskIds: [...new Set(mergedFromTaskIds)],
    mergedFromTitles: [...new Set(mergedFromTitles)]
  };
}

function resolveMergeRoot(taskId, mergedIntoByTaskId) {
  let current = String(taskId || "").trim();
  const visited = new Set();
  while (current && mergedIntoByTaskId[current] && !visited.has(current)) {
    visited.add(current);
    const next = String(mergedIntoByTaskId[current] || "").trim();
    if (!next || next === current) break;
    current = next;
  }
  return current;
}

function applyTaskRelations(tasks, relations) {
  const normalized = normalizeTaskRelations(relations);
  const resolved = resolveRelationMaps(tasks || [], normalized);
  const taskMap = new Map((tasks || []).map((task) => [task.taskId, { ...task }]));
  const suppressed = new Set();

  for (const [childTaskId, parentTaskId] of Object.entries(resolved.mergedIntoByTaskId || {})) {
    const child = taskMap.get(childTaskId);
    const parentRootId = resolveMergeRoot(parentTaskId, resolved.mergedIntoByTaskId || {});
    const parent = taskMap.get(parentRootId);
    if (!child || !parent || child.taskId === parent.taskId) {
      continue;
    }
    const merged = mergeTaskRecords(parent, child);
    taskMap.set(parent.taskId, merged);
    suppressed.add(child.taskId);
  }

  const output = [];
  for (const task of taskMap.values()) {
    if (suppressed.has(task.taskId)) {
      continue;
    }
    output.push(task);
  }

  output.sort((a, b) => Number(b.lastActivityTs || 0) - Number(a.lastActivityTs || 0));
  lastResolvedKeepSeparatePairs = resolved.keepSeparatePairs || {};
  return autoConsolidateTasks(output, lastResolvedKeepSeparatePairs);
}

function duplicateScore(taskA, taskB) {
  const domainsA = new Set([taskA.domain, ...(taskA.domains || [])].filter(Boolean));
  const domainsB = new Set([taskB.domain, ...(taskB.domains || [])].filter(Boolean));
  let sharedDomainCount = 0;
  for (const domain of domainsA) {
    if (domainsB.has(domain)) {
      sharedDomainCount += 1;
    }
  }

  const tokensA = taskTokenSet(taskA);
  const tokensB = taskTokenSet(taskB);
  const tokenOverlap = overlapRatio(tokensA, tokensB);
  const sharedTokenCount = [...tokensA].filter((token) => tokensB.has(token)).length;
  const categoryBonus = taskA.category === taskB.category ? 0.12 : 0;

  return tokenOverlap + (sharedDomainCount > 0 ? 0.25 : 0) + (sharedTokenCount >= 2 ? 0.15 : 0) + categoryBonus;
}

function taskUrlSet(task) {
  return new Set(
    [
      ...(task.urls || []),
      ...((task.pages || []).map((page) => page.url))
    ]
      .map((url) => canonicalRelationUrl(url))
      .filter(Boolean)
  );
}

function urlOverlapScore(taskA, taskB) {
  const urlsA = [...taskUrlSet(taskA)];
  const urlsB = [...taskUrlSet(taskB)];
  return relationOverlapRatio(urlsA, urlsB);
}

function autoConsolidateTasks(tasks, keepSeparatePairs) {
  let working = [...(tasks || [])];
  let changed = true;
  let safety = 0;

  while (changed && safety < 25) {
    changed = false;
    safety += 1;

    for (let i = 0; i < working.length; i += 1) {
      for (let j = i + 1; j < working.length; j += 1) {
        const a = working[i];
        const b = working[j];
        const key = taskPairKey(a.taskId, b.taskId);
        if (keepSeparatePairs[key]) {
          continue;
        }

        const sameDomain = String(a.domain || "") === String(b.domain || "");
        const urlOverlap = urlOverlapScore(a, b);
        const similarity = duplicateScore(a, b);
        const score = similarity + urlOverlap + (sameDomain ? 0.12 : 0);

        const shouldMerge =
          score >= 0.95 ||
          (sameDomain && (urlOverlap >= 0.28 || similarity >= 0.68));

        if (!shouldMerge) {
          continue;
        }

        const primary = Number(a.lastActivityTs || 0) >= Number(b.lastActivityTs || 0) ? a : b;
        const secondary = primary.taskId === a.taskId ? b : a;
        const merged = mergeTaskRecords(primary, secondary);
        working = working.filter((task) => task.taskId !== primary.taskId && task.taskId !== secondary.taskId);
        working.push(merged);
        changed = true;
        break;
      }
      if (changed) {
        break;
      }
    }
  }

  working.sort((a, b) => Number(b.lastActivityTs || 0) - Number(a.lastActivityTs || 0));
  return working;
}

function detectDuplicateCandidates(tasks, keepSeparatePairs) {
  const map = new Map();
  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      const taskA = tasks[i];
      const taskB = tasks[j];
      const pairKey = taskPairKey(taskA.taskId, taskB.taskId);
      if (keepSeparatePairs[pairKey]) {
        continue;
      }

      const score = duplicateScore(taskA, taskB);
      if (score < 0.55) {
        continue;
      }

      const preferred = Number(taskA.lastActivityTs || 0) >= Number(taskB.lastActivityTs || 0) ? taskA : taskB;
      const secondary = preferred.taskId === taskA.taskId ? taskB : taskA;

      if (!map.has(preferred.taskId) || map.get(preferred.taskId).score < score) {
        map.set(preferred.taskId, {
          otherTaskId: secondary.taskId,
          otherTaskTitle: secondary.title,
          otherTaskSnapshot: taskRelationSnapshot(secondary),
          score: Number(score.toFixed(2))
        });
      }
    }
  }
  return map;
}

function createPagePreviewItem(page) {
  const item = createEl("li");
  const state = createEl("span", "pill", stateLabel(page.state));
  const link = createEl("a", null, pageDisplayName(page));
  link.href = safeHref(page.url);
  link.target = "_blank";
  link.rel = "noreferrer";
  const progress = Math.round(pageReadingProgressPct(page));
  const minutesLeft = pageMinutesLeft(page);
  const progressMeta = createEl(
    "div",
    "page-progress-meta",
    `Progress ${progress}% • ${minutesLeft > 0 ? `~${minutesLeft}m left` : "done"}`
  );
  const progressBar = createEl("div", "page-progress-bar");
  const progressFill = createEl("span", "page-progress-fill");
  progressFill.style.width = `${progress}%`;
  progressBar.appendChild(progressFill);

  const info = createEl("div", "page-main");
  info.appendChild(link);
  info.appendChild(progressMeta);
  info.appendChild(progressBar);

  item.appendChild(state);
  item.appendChild(info);
  return item;
}

function createTaskCard(task, onMutate, duplicateCandidate = null) {
  const card = createEl("article", "card");
  card.dataset.taskId = task.taskId;
  const primaryTaskSnapshot = taskRelationSnapshot(task);

  card.appendChild(createEl("h2", null, safeTaskTitle(task)));
  card.appendChild(
    createEl(
      "div",
      "meta",
      `${task.stats.pageCount} pages • status ${statusLabel(task)} • last activity ${formatTime(
        task.lastActivityTs
      )}`
    )
  );
  card.appendChild(createEl("p", "brief", task.briefing));

  const favored = task.decisionContext?.favoredLabel;
  const reasons = task.decisionContext?.reasons || [];
  const missingSignals = task.decisionContext?.missingSignals || [];
  if (favored) {
    card.appendChild(
      createEl(
        "p",
        "meta",
        `You favored "${favored}" because you ${reasons.join(", ") || `spent ${formatDuration(task.pages?.[0]?.activeMs)}`}.`
      )
    );
  }
  if (missingSignals.length) {
    card.appendChild(createEl("p", "meta", `Missing signal: ${missingSignals[0]}`));
  }

  if (task.deadEnd?.detected) {
    const deadEnd = createEl("p", "meta");
    deadEnd.textContent = `Dead-end prevention: ${task.deadEnd.message}`;
    deadEnd.style.color = "#8a3f00";
    card.appendChild(deadEnd);
  }

  card.appendChild(
    createEl(
      "p",
      "meta",
      `Read ${task.stats.readCount} • Skimmed ${task.stats.skimmedCount} • Unopened ${task.stats.unopenedCount} • Closed quickly ${task.stats.bouncedCount}`
    )
  );
  const progressSummary = taskProgressSummary(task);
  card.appendChild(
    createEl(
      "p",
      "meta",
      `Reading progress ${progressSummary.progressPct}% • estimated ${Math.max(
        0,
        progressSummary.minutesLeft
      )}m to finish`
    )
  );

  const list = createEl("ul", "urls");
  for (const page of task.pages.slice(0, 4)) {
    list.appendChild(createPagePreviewItem(page));
  }
  card.appendChild(list);

  if (Array.isArray(task.relatedTasks) && task.relatedTasks.length) {
    const related = task.relatedTasks[0];
    card.appendChild(
      createEl(
        "p",
        "meta",
        `Related thread: This may continue "${related.title}" (${relativeAge(
          related.lastActivityTs
        )}, ${related.reason}).`
      )
    );

    const relatedRow = createEl("div", "cta-row");
    const jumpBtn = createEl("button", "rename", "Open Related Task");
    jumpBtn.addEventListener("click", async () => {
      try {
        await sendMessageOrThrow({
          type: MESSAGE_TYPES.OPEN_BRIEFING_PAGE,
          taskId: related.taskId
        });
      } catch (error) {
        window.alert(String(error?.message || error || "Could not open related task"));
      }
    });
    relatedRow.appendChild(jumpBtn);
    card.appendChild(relatedRow);
  }

  if (duplicateCandidate?.otherTaskId) {
    const dupBlock = createEl(
      "p",
      "meta",
      `Possible fragment: "${safeTaskTitle(task)}" may overlap with "${duplicateCandidate.otherTaskTitle}".`
    );
    card.appendChild(dupBlock);
  }

  const ctaRow = createEl("div", "cta-row");

  const guidedResumeBtn = createEl("button", "resume", "Guided Resume");
  guidedResumeBtn.addEventListener("click", async () => {
    try {
      const urls = orderedResumeUrls(task);
      if (!urls.length) {
        throw new Error("No pages available to resume for this task yet.");
      }
      await sendMessageOrThrow({
        type: MESSAGE_TYPES.RESUME_TASK,
        taskId: task.taskId,
        urls
      });
    } catch (error) {
      window.alert(String(error?.message || error || "Could not resume task"));
    }
  });

  const manageBtn = createEl("button", "rename", "Manage Group...");
  manageBtn.addEventListener("click", async () => {
    try {
      const action = promptSelectFromList(
        `Manage "${safeTaskTitle(task)}"`,
        [
          { label: "Rename group", value: "rename" },
          { label: "Move this group to another group", value: "move_group" },
          { label: "Delete one page from this group", value: "delete_page" },
          { label: "Delete this whole group context", value: "delete_group" },
          { label: "Cancel", value: "cancel" }
        ]
      );

      if (!action || action === "cancel") {
        return;
      }

      if (action === "rename") {
        const nextTitle = window.prompt("Rename task", task.title);
        if (nextTitle === null) {
          return;
        }
        await sendMessageOrThrow({
          type: MESSAGE_TYPES.RENAME_TASK,
          taskId: task.taskId,
          title: nextTitle.trim()
        });
        await onMutate();
        return;
      }

      if (action === "move_group") {
        const candidateTasks = (lastTasks || [])
          .filter((item) => item.taskId !== task.taskId)
          .map((item) => ({
            label: `${safeTaskTitle(item)} • ${item.stats?.pageCount || 0} pages`,
            value: item
          }));

        if (!candidateTasks.length) {
          throw new Error("No other groups available to move into.");
        }

        const destination = promptSelectFromList(
          "Move this group to which destination group?",
          candidateTasks
        );
        if (!destination) {
          return;
        }

        await sendMessageOrThrow({
          type: MESSAGE_TYPES.MERGE_TASKS,
          primaryTaskId: destination.taskId,
          secondaryTaskId: task.taskId,
          primaryTaskSnapshot: taskRelationSnapshot(destination),
          secondaryTaskSnapshot: primaryTaskSnapshot
        });
        await onMutate();
        return;
      }

      if (action === "delete_page") {
        const pageOptions = (task.pages || []).map((page) => ({
          label: `${pageDisplayName(page)} • ${stateLabel(page.state)}`,
          value: page
        }));
        if (!pageOptions.length) {
          throw new Error("No pages available in this group.");
        }

        const selectedPage = promptSelectFromList("Delete which page from this group?", pageOptions);
        if (!selectedPage?.url) {
          return;
        }

        const confirmed = window.confirm(
          `Delete "${pageDisplayName(selectedPage)}" from this group context?`
        );
        if (!confirmed) {
          return;
        }

        await sendMessageOrThrow({
          type: MESSAGE_TYPES.DELETE_TASK,
          taskId: task.taskId,
          urls: [selectedPage.url]
        });
        await onMutate();
        return;
      }

      if (action === "delete_group") {
        const confirmed = window.confirm(
          "Delete this group context? This removes its stored browsing events from local history."
        );
        if (!confirmed) {
          return;
        }

        await sendMessageOrThrow({
          type: MESSAGE_TYPES.DELETE_TASK,
          taskId: task.taskId,
          urls: task.urls
        });
        await onMutate();
      }
    } catch (error) {
      window.alert(String(error?.message || error || "Could not manage group"));
    }
  });

  const doneBtn = createEl("button", "done", task.status === "done" ? "Reopen Task" : "Mark Done");
  doneBtn.addEventListener("click", async () => {
    try {
      const done = task.status !== "done";
      await sendMessageOrThrow(
        {
          type: MESSAGE_TYPES.SET_TASK_DONE,
          taskId: task.taskId,
          done
        },
        {
          type: MESSAGE_TYPES.SET_TASK_LIFECYCLE,
          taskId: task.taskId,
          status: done ? "done" : "active"
        }
      );
      await onMutate();
    } catch (error) {
      window.alert(String(error?.message || error || "Could not update task status"));
    }
  });

  const remindBtn = createEl("button", "rename", "Remind...");
  remindBtn.addEventListener("click", async () => {
    try {
      const remindAtTs = parseRemindAtPrompt(Date.now() + 24 * 60 * 60 * 1000);
      if (!remindAtTs) {
        return;
      }
      await sendMessageOrThrow({
        type: MESSAGE_TYPES.REMIND_TASK_AT,
        taskId: task.taskId,
        remindAtTs
      });
      await onMutate();
    } catch (error) {
      window.alert(String(error?.message || error || "Could not set reminder"));
    }
  });

  ctaRow.appendChild(guidedResumeBtn);
  ctaRow.appendChild(manageBtn);
  ctaRow.appendChild(doneBtn);
  ctaRow.appendChild(remindBtn);
  card.appendChild(ctaRow);

  return card;
}

function createDetailedCard(task, overlapTitles = []) {
  const card = createEl("article", "summary-card");
  card.appendChild(createEl("h3", null, safeTaskTitle(task)));
  card.appendChild(
    createEl(
      "p",
      "meta",
      `${task.stats.pageCount} pages • domains: ${taskDomainsLabel(task)} • status ${statusLabel(task)} • last active ${formatTime(task.lastActivityTs)}`
    )
  );
  card.appendChild(createEl("p", null, `Objective: ${objectiveLabel(task)}`));
  card.appendChild(
    createEl(
      "p",
      "meta",
      `Intent signal: ${intentLabel(task)} (${intentScore(task)}/100) • Active time ${formatDurationLong(totalActiveMs(task))}`
    )
  );
  const progressSummary = taskProgressSummary(task);
  card.appendChild(
    createEl(
      "p",
      "meta",
      `Reading progress ${progressSummary.progressPct}% • estimated ${Math.max(
        0,
        progressSummary.minutesLeft
      )}m remaining`
    )
  );

  const decision = task.decisionContext || {};
  if (decision.favoredLabel) {
    const reasonText = (decision.reasons || []).join(", ") || "engagement signals";
    card.appendChild(createEl("p", null, `Leaning toward: "${decision.favoredLabel}" because ${reasonText}.`));
  }

  const nextPage = nextBestPage(task);
  if (nextPage) {
    card.appendChild(
      createEl(
        "p",
        "meta",
        `Best next page: ${pageDisplayName(nextPage)} (${stateLabel(nextPage.state)}, ${Math.round(nextPage.interestScore)}% interest, ${Math.round(nextPage.completionScore)}% complete)`
      )
    );
  }

  const findings = summarizeTaskFindings(task);
  if (findings.length) {
    const findingsHeading = createEl("p", "meta", "What we detected");
    const findingList = createEl("ul", "summary-list");
    for (const line of findings.slice(0, 2)) {
      findingList.appendChild(createEl("li", null, line));
    }
    card.appendChild(findingsHeading);
    card.appendChild(findingList);
  }

  const actionHeading = createEl("p", "meta", "Finish plan");
  const actionList = createEl("ul", "summary-list");
  for (const step of buildActionPlan(task)) {
    actionList.appendChild(createEl("li", null, step));
  }
  card.appendChild(actionHeading);
  card.appendChild(actionList);

  if (overlapTitles.length) {
    const overlapText = overlapTitles.join(" • ");
    card.appendChild(
      createEl(
        "p",
        "meta",
        `Possible duplicate context: this looks related to ${overlapText}. Consider deleting/closing one to avoid split context.`
      )
    );
  }

  if (Array.isArray(task.relatedTasks) && task.relatedTasks.length) {
    const relatedList = createEl("ul", "summary-list");
    for (const related of task.relatedTasks.slice(0, 2)) {
      relatedList.appendChild(
        createEl(
          "li",
          null,
          `Related: ${related.title} (${relativeAge(related.lastActivityTs)}, ${related.reason})`
        )
      );
    }
    card.appendChild(createEl("p", "meta", "Related Past Threads"));
    card.appendChild(relatedList);
  }

  if (task.deadEnd?.detected) {
    const deadEnd = createEl("p", "meta", `Loop detected: ${task.deadEnd.message}`);
    deadEnd.style.color = "#8a3f00";
    card.appendChild(deadEnd);
  }

  return card;
}

function renderOverview(tasks) {
  overviewEl.innerHTML = "";
  const duplicateCandidates = detectDuplicateCandidates(tasks, lastResolvedKeepSeparatePairs || {});
  for (const task of tasks) {
    overviewEl.appendChild(createTaskCard(task, loadFeed, duplicateCandidates.get(task.taskId) || null));
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

function renderDetailedBriefing(tasks) {
  detailedEl.innerHTML = "";
  const note = createEl(
    "div",
    "ai-note",
    "Action Plan gives objective, decision context, and exact next steps so you can finish quickly."
  );
  detailedEl.appendChild(note);

  const overlapMap = buildOverlapMap(tasks);
  for (const task of tasks) {
    detailedEl.appendChild(createDetailedCard(task, overlapMap.get(task.taskId) || []));
  }
}

function createDayCard(summary) {
  const card = createEl("article", "day-card");
  card.appendChild(createEl("h3", null, formatDayKey(summary.day)));
  card.appendChild(
    createEl("p", "meta", `Active browsing time: ${formatDurationLong(summary.totalActiveMs)}`)
  );
  card.appendChild(createEl("p", null, summary.semanticSummary || "No summary available."));

  const tags = createEl("div", "tag-row");
  for (const item of summary.topCategories || []) {
    tags.appendChild(
      createEl("span", "tag", `${item.category}: ${formatDurationLong(item.activeMs)} (${Math.round(item.pct)}%)`)
    );
  }
  if ((summary.topCategories || []).length) {
    card.appendChild(tags);
  }

  if ((summary.topTasks || []).length) {
    const topTasks = createEl(
      "p",
      "meta",
      `Main intentions: ${(summary.topTasks || []).slice(0, 3).join(" • ")}`
    );
    card.appendChild(topTasks);
  }

  const sinks = summary.likelyTimeSinks || [];
  if (sinks.length) {
    card.appendChild(createEl("p", "meta", "Likely time sinks (possible wasted time):"));
    for (const sink of sinks) {
      const block = createEl("div", "sink");
      block.appendChild(createEl("strong", null, sink.label));
      block.appendChild(createEl("p", null, sink.detail));
      card.appendChild(block);
    }
  } else {
    card.appendChild(createEl("p", "meta", "No major time-sink patterns detected."));
  }

  if (summary.coaching) {
    card.appendChild(createEl("p", "meta", `Suggestion: ${summary.coaching}`));
  }

  return card;
}

function renderDailySummary(summaries) {
  dailyEl.innerHTML = "";
  const note = createEl(
    "div",
    "ai-note",
    "Daily Recap estimates semantic time use from browsing engagement signals."
  );
  dailyEl.appendChild(note);

  if (!summaries.length) {
    dailyEl.appendChild(createEl("article", "summary-card", "No daily summary data yet."));
    return;
  }

  for (const summary of summaries) {
    dailyEl.appendChild(createDayCard(summary));
  }
}

function normalizeDisplayStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["active", "done", "snoozed", "dropped"].includes(value)) {
    return value;
  }
  return "active";
}

function mergeCloudWithLocalTasks(remoteTasks, localTasks, includeDone) {
  const localById = new Map((localTasks || []).map((task) => [task.taskId, task]));
  const seen = new Set();
  const merged = [];

  for (const remote of remoteTasks || []) {
    const local = localById.get(remote.taskId);
    seen.add(remote.taskId);
    if (!local) {
      merged.push({
        ...remote,
        status: normalizeDisplayStatus(remote.status)
      });
      continue;
    }

    merged.push({
      ...remote,
      status: normalizeDisplayStatus(local.status || remote.status),
      workflowState: local.workflowState || remote.workflowState,
      urls:
        Array.isArray(remote.urls) && remote.urls.length
          ? remote.urls
          : Array.isArray(local.urls)
            ? local.urls
            : [],
      resumePlan: local.resumePlan || remote.resumePlan,
      timeline: local.timeline || remote.timeline,
      decisionContext: local.decisionContext || remote.decisionContext,
      deadEnd: local.deadEnd || remote.deadEnd,
      adapter: local.adapter || remote.adapter,
      relatedTasks:
        Array.isArray(local.relatedTasks) && local.relatedTasks.length
          ? local.relatedTasks
          : Array.isArray(remote.relatedTasks)
            ? remote.relatedTasks
            : [],
      briefing: local.briefing || remote.briefing,
      nextAction: local.nextAction || remote.nextAction,
      pages:
        Array.isArray(remote.pages) && remote.pages.length
          ? remote.pages
          : Array.isArray(local.pages)
            ? local.pages
            : [],
      stats: remote.stats && Object.keys(remote.stats || {}).length ? remote.stats : local.stats
    });
  }

  for (const local of localTasks || []) {
    if (seen.has(local.taskId)) {
      continue;
    }
    merged.push(local);
  }

  const filtered = includeDone
    ? merged
    : merged.filter((task) => normalizeDisplayStatus(task.status) === "active");

  filtered.sort((a, b) => Number(b.lastActivityTs || 0) - Number(a.lastActivityTs || 0));
  return filtered.slice(0, 80);
}

function setMode(mode) {
  currentMode = mode;

  const panels = {
    overview: overviewEl,
    daily: dailyEl,
    detailed: detailedEl
  };

  for (const [name, panel] of Object.entries(panels)) {
    panel.hidden = name !== currentMode;
  }

  for (const button of modeButtons) {
    const active = button.dataset.mode === currentMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }

  const hasDataForMode =
    currentMode === "daily" ? lastDailySummaries.length > 0 : lastTasks.length > 0;
  if (!hasDataForMode) {
    emptyEl.textContent =
      currentMode === "daily"
        ? "No daily recap yet. Browse for a while, then refresh."
        : "No active tasks yet. Browse, then refresh.";
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;
  if (currentMode === "overview") {
    renderOverview(lastTasks);
  } else if (currentMode === "daily") {
    renderDailySummary(lastDailySummaries);
  } else if (currentMode === "detailed") {
    renderDetailedBriefing(lastTasks);
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
      const localResponse = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.GET_TASK_FEED,
        filters: { limit: 300, includeDone: true }
      });
      const localTasks = localResponse?.ok ? localResponse.tasks || [] : [];
      lastTasks = mergeCloudWithLocalTasks(remoteResponse.tasks || [], localTasks, includeDone);
      usedCloud = true;
      const serverText = remoteResponse.serverTs ? formatTime(remoteResponse.serverTs) : "unknown";
      const syncText = remoteResponse.syncError ? `sync warning: ${remoteResponse.syncError}` : "sync ok";
      setSourceInfo(`Source: cloud + local enrichment • server ${serverText} • ${syncText}`);
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
    lastTasks = (response.tasks || []).map((task) => ({
      ...task,
      status: normalizeDisplayStatus(task.status)
    }));
    setSourceInfo(cloudError ? `Source: local fallback • ${cloudError}` : "Source: local");
  }

  const relationResponse = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.GET_TASK_RELATIONS
  });
  lastTaskRelations = relationResponse?.ok
    ? normalizeTaskRelations(relationResponse.taskRelations)
    : { mergedIntoByTaskId: {}, keepSeparatePairs: {}, mergeRules: [], keepSeparateRules: [] };
  lastTasks = applyTaskRelations(lastTasks, lastTaskRelations);

  const dailyResponse = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.GET_DAILY_SUMMARY,
    filters: { days: 7 }
  });
  lastDailySummaries = dailyResponse?.ok ? dailyResponse.summaries || [] : [];

  overviewEl.innerHTML = "";
  dailyEl.innerHTML = "";
  detailedEl.innerHTML = "";

  setMode(currentMode);
}

refreshBtn.addEventListener("click", () => {
  loadFeed().catch((error) => {
    overviewEl.innerHTML = `<article class="card">${error.message}</article>`;
    dailyEl.innerHTML = "";
    detailedEl.innerHTML = "";
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
