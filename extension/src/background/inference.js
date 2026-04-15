const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAM_KEYS = new Set(["fbclid", "gclid", "mc_cid", "mc_eid", "fbvar"]);
const SEARCH_QUERY_KEYS = new Set([
  "q",
  "k",
  "keyword",
  "keywords",
  "query",
  "search_query",
  "field-keywords",
  "p",
  "term"
]);
const NON_SEARCH_STABLE_PARAM_KEYS = new Set([
  "id",
  "itemid",
  "item_id",
  "productid",
  "product_id",
  "pid",
  "sku",
  "asin"
]);
const GENERIC_TITLES = new Set(["new tab", "tab", "google chrome", "chrome"]);
const TOPIC_STOPWORDS = new Set([
  "www",
  "com",
  "https",
  "http",
  "search",
  "product",
  "products",
  "item",
  "items",
  "shop",
  "store",
  "page",
  "pages",
  "home",
  "official",
  "index",
  "title",
  "new",
  "best",
  "sale",
  "with",
  "from",
  "this",
  "that",
  "your",
  "for",
  "and",
  "the",
  "you",
  "balls",
  "tab",
  "browse",
  "thread",
  "chrome",
  "google",
  "results",
  "result",
  "paper",
  "article",
  "blog",
  "post"
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isGenericTitle(title) {
  const normalized = String(title || "").trim().toLowerCase();
  return !normalized || GENERIC_TITLES.has(normalized);
}

function normalizeToken(rawToken) {
  let token = String(rawToken || "").toLowerCase();
  if (!token) {
    return "";
  }
  if (/^\d+$/.test(token)) {
    return "";
  }

  if (token.endsWith("ies") && token.length > 4) {
    token = `${token.slice(0, -3)}y`;
  } else if (token.endsWith("s") && token.length > 4 && !token.endsWith("ss")) {
    token = token.slice(0, -1);
  }

  if (token.length < 3) {
    return "";
  }
  return token;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .split(/[^a-z0-9]+/)
    .map((token) => normalizeToken(token))
    .filter(Boolean);
}

function jaccard(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) {
    return 0;
  }

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;

  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }

  const union = setA.size + setB.size - intersection;
  return union ? intersection / union : 0;
}

function sharedTokenCount(tokensA, tokensB) {
  const setA = new Set(tokensA || []);
  const setB = new Set(tokensB || []);
  let count = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      count += 1;
    }
  }
  return count;
}

function sameBaseDomain(domainA, domainB) {
  const partsA = String(domainA || "").split(".").filter(Boolean);
  const partsB = String(domainB || "").split(".").filter(Boolean);
  if (partsA.length < 2 || partsB.length < 2) {
    return false;
  }

  const baseA = partsA.slice(-2).join(".");
  const baseB = partsB.slice(-2).join(".");
  return baseA === baseB;
}

function hashString(input) {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function isSearchLikePath(pathname) {
  const path = String(pathname || "").toLowerCase();
  return (
    path.includes("/search") ||
    path.includes("/results") ||
    path === "/s" ||
    path.startsWith("/s/") ||
    path.includes("/s/ref")
  );
}

function isTrackingParam(key) {
  if (TRACKING_PARAM_KEYS.has(key)) {
    return true;
  }
  if (TRACKING_PARAM_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return true;
  }

  return (
    key.startsWith("ref") ||
    key.startsWith("fb_") ||
    key.startsWith("ga_") ||
    key.startsWith("gbraid") ||
    key.startsWith("wbraid") ||
    key.startsWith("gad_") ||
    key.startsWith("spm") ||
    key.startsWith("sc_") ||
    key.startsWith("session")
  );
}

function normalizeHost(hostname) {
  return String(hostname || "").toLowerCase().replace(/^www\./, "");
}

function countSessions(timestamps, gapMs) {
  if (!timestamps.length) {
    return 0;
  }

  const sorted = [...timestamps].sort((a, b) => a - b);
  let sessions = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] > gapMs) {
      sessions += 1;
    }
  }

  return sessions;
}

function countReturns(timestamps, minGapMs) {
  if (timestamps.length < 2) {
    return 0;
  }

  const sorted = [...timestamps].sort((a, b) => a - b);
  let count = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] >= minGapMs) {
      count += 1;
    }
  }

  return count;
}

function extractQueryTokens(urlString) {
  try {
    const url = new URL(urlString);
    const tokens = [];
    for (const [, value] of url.searchParams.entries()) {
      tokens.push(...tokenize(value));
    }
    return tokens;
  } catch {
    return [];
  }
}

function extractSemanticTokens(urlString, title = "") {
  const titleTokens = tokenize(title);
  try {
    const url = new URL(urlString);
    const domainParts = new Set(url.hostname.split(".").filter(Boolean));
    const pathTokens = tokenize(url.pathname);

    return [...new Set([...titleTokens, ...pathTokens])].filter(
      (token) => !domainParts.has(token) && !TOPIC_STOPWORDS.has(token)
    );
  } catch {
    return [...new Set(titleTokens)].filter((token) => !TOPIC_STOPWORDS.has(token));
  }
}

function extractTopicTokens(urlString, semanticTokens = [], queryTokens = []) {
  try {
    const url = new URL(urlString);
    const domainParts = new Set(url.hostname.split(".").filter(Boolean));
    const unique = new Set();

    for (const token of [...queryTokens, ...semanticTokens]) {
      if (token.length < 3) {
        continue;
      }
      if (domainParts.has(token) || TOPIC_STOPWORDS.has(token)) {
        continue;
      }
      unique.add(token);
    }

    return [...unique];
  } catch {
    return [...new Set([...queryTokens, ...semanticTokens])].filter(
      (token) => token.length >= 3 && !TOPIC_STOPWORDS.has(token)
    );
  }
}

function pageSimilarity(pageA, pageB) {
  const semantic = jaccard(pageA.semanticTokens, pageB.semanticTokens);
  const topicOverlap = jaccard(pageA.topicTokens, pageB.topicTokens);

  let domainOverlap = 0;
  if (pageA.domain === pageB.domain) {
    domainOverlap = topicOverlap >= 0.1 ? 1 : 0.15;
  } else if (sameBaseDomain(pageA.domain, pageB.domain)) {
    domainOverlap = 0.6;
  }

  const diffMs = Math.abs(pageA.lastTs - pageB.lastTs);
  const fortyFiveMin = 45 * 60 * 1000;
  const twoHours = 2 * 60 * 60 * 1000;
  let temporalAdjacency = 0;
  if (diffMs <= fortyFiveMin) {
    temporalAdjacency = 1;
  } else if (diffMs <= twoHours) {
    temporalAdjacency = 1 - (diffMs - fortyFiveMin) / (twoHours - fortyFiveMin);
  }

  const queryOverlap = jaccard(pageA.queryTokens, pageB.queryTokens);

  let revisitCooccurrence = 0;
  if (pageA.revisitCount > 0 && pageB.revisitCount > 0) {
    revisitCooccurrence =
      Math.min(pageA.revisitCount, pageB.revisitCount) /
      Math.max(pageA.revisitCount, pageB.revisitCount);
  }

  const topicTemporalBoost =
    topicOverlap >= 0.18 && temporalAdjacency >= 0.4 ? 0.22 : 0;

  let categoryAdjustment = 0;
  if (pageA.categoryHint === pageB.categoryHint && pageA.categoryHint !== "other") {
    categoryAdjustment = 0.08;
  } else if (
    pageA.categoryHint !== pageB.categoryHint &&
    pageA.categoryHint !== "other" &&
    pageB.categoryHint !== "other"
  ) {
    categoryAdjustment = -0.2;
  }

  return {
    score:
      0.28 * semantic +
      0.2 * domainOverlap +
      0.2 * temporalAdjacency +
      0.22 * topicOverlap +
      0.1 * queryOverlap +
      0.1 * revisitCooccurrence +
      topicTemporalBoost +
      categoryAdjustment,
    semantic,
    topicOverlap,
    domainOverlap,
    temporalAdjacency,
    queryOverlap,
    revisitCooccurrence,
    topicTemporalBoost,
    categoryAdjustment
  };
}

function componentSignature(componentPages) {
  const domainCounts = new Map();
  const semanticTokens = [];
  const topicTokens = [];
  const queryTokens = [];
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = 0;

  for (const page of componentPages) {
    domainCounts.set(page.domain, (domainCounts.get(page.domain) || 0) + 1);
    semanticTokens.push(...page.semanticTokens);
    topicTokens.push(...page.topicTokens);
    queryTokens.push(...page.queryTokens);
    minTs = Math.min(minTs, page.firstTs);
    maxTs = Math.max(maxTs, page.lastTs);
  }

  const primaryDomain = [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const category = classifyTaskCategory(
    componentPages.map((page) => `${page.titleLatest} ${page.url}`).join(" ")
  );

  return {
    primaryDomain,
    category,
    semanticTokens,
    topicTokens,
    queryTokens,
    minTs,
    maxTs
  };
}

function shouldMergeComponents(componentA, componentB, pages) {
  const pagesA = componentA.map((index) => pages[index]);
  const pagesB = componentB.map((index) => pages[index]);
  const sigA = componentSignature(pagesA);
  const sigB = componentSignature(pagesB);

  const temporalDistance = Math.abs(sigA.maxTs - sigB.maxTs);
  const sameDomain = sigA.primaryDomain === sigB.primaryDomain;
  const semanticOverlap = jaccard(sigA.semanticTokens, sigB.semanticTokens);
  const topicOverlap = jaccard(sigA.topicTokens, sigB.topicTokens);
  const sharedTopics = sharedTokenCount(sigA.topicTokens, sigB.topicTokens);
  const queryOverlap = jaccard(sigA.queryTokens, sigB.queryTokens);

  if (sameDomain) {
    if (topicOverlap >= 0.1 || semanticOverlap >= 0.15 || queryOverlap >= 0.1) {
      return true;
    }

    if (
      temporalDistance <= 20 * 60 * 1000 &&
      sigA.category === sigB.category &&
      sigA.category !== "other" &&
      (topicOverlap >= 0.08 || semanticOverlap >= 0.08 || queryOverlap >= 0.05)
    ) {
      return true;
    }
  }

  if (
    sigA.category === sigB.category &&
    sigA.category === "research" &&
    temporalDistance <= 4 * 60 * 60 * 1000 &&
    (sharedTopics >= 1 || topicOverlap >= 0.12 || semanticOverlap >= 0.14)
  ) {
    return true;
  }

  if (
    sigA.category === "shopping" &&
    sigB.category === "shopping" &&
    temporalDistance <= 3 * 60 * 60 * 1000 &&
    (sharedTopics >= 1 || topicOverlap >= 0.04 || semanticOverlap >= 0.06 || queryOverlap >= 0.03)
  ) {
    return true;
  }

  return false;
}

function mergeComponentsHeuristically(components, pages) {
  if (components.length <= 1) {
    return components;
  }

  const parent = components.map((_, i) => i);
  const find = (x) => {
    let root = x;
    while (parent[root] !== root) {
      root = parent[root];
    }
    while (parent[x] !== x) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent[rb] = ra;
    }
  };

  for (let i = 0; i < components.length; i += 1) {
    for (let j = i + 1; j < components.length; j += 1) {
      if (shouldMergeComponents(components[i], components[j], pages)) {
        union(i, j);
      }
    }
  }

  const grouped = new Map();
  for (let i = 0; i < components.length; i += 1) {
    const root = find(i);
    if (!grouped.has(root)) {
      grouped.set(root, []);
    }
    grouped.get(root).push(...components[i]);
  }

  return [...grouped.values()].map((indexes) => [...new Set(indexes)]);
}

function splitOutliersInComponent(indexes, pages) {
  if (indexes.length < 3) {
    return [indexes];
  }

  const scores = new Map();
  for (let i = 0; i < indexes.length; i += 1) {
    const idx = indexes[i];
    let sum = 0;
    let count = 0;
    for (let j = 0; j < indexes.length; j += 1) {
      if (i === j) continue;
      const otherIdx = indexes[j];
      sum += pageSimilarity(pages[idx], pages[otherIdx]).score;
      count += 1;
    }
    scores.set(idx, count ? sum / count : 0);
  }

  const outliers = indexes.filter((idx) => {
    const page = pages[idx];
    const avg = scores.get(idx) || 0;
    return (
      avg < 0.18 &&
      page.activeMs < 20_000 &&
      page.revisitCount === 0 &&
      page.maxScrollPct < 20
    );
  });

  if (!outliers.length || outliers.length === indexes.length) {
    return [indexes];
  }

  const outlierSet = new Set(outliers);
  const remaining = indexes.filter((idx) => !outlierSet.has(idx));
  const groups = [];
  if (remaining.length) {
    groups.push(remaining);
  }
  for (const idx of outliers) {
    groups.push([idx]);
  }
  return groups;
}

function classifyTaskCategory(text) {
  const haystack = text.toLowerCase();
  if (
    /shop|product|checkout|cart|jacket|dress|reformation|gap|american eagle|zara|h&m|uniqlo/.test(
      haystack
    )
  ) {
    return "shopping";
  }

  if (/flight|hotel|airbnb|booking|kayak|expedia|maps|trip|travel/.test(haystack)) {
    return "travel";
  }

  if (/news|article|anthropic|openai|research|paper|model|blog/.test(haystack)) {
    return "research";
  }

  if (/reddit|x\.com|twitter|instagram|tiktok|youtube/.test(haystack)) {
    return "social";
  }

  return "other";
}

function classifyPageState(page, completionScore) {
  if (page.visitCount === 0 && page.activeMs === 0) {
    return "unopened";
  }
  if (page.activeMs < 10_000 && page.maxScrollPct < 10 && page.revisitCount === 0) {
    return "bounced";
  }
  if (page.activeMs >= 75_000 && page.maxScrollPct >= 55 && completionScore >= 55) {
    return "read";
  }
  return "skimmed";
}

function computeInterestScore(page, maxActiveMsInTask) {
  const normalizedActiveTime = clamp(page.activeMs / Math.max(maxActiveMsInTask, 1), 0, 1) * 100;
  const revisitScore = clamp(page.revisitCount / 4, 0, 1) * 100;
  const deepScrollScore = clamp(page.maxScrollPct / 100, 0, 1) * 100;
  const interactionPauseScore = clamp(page.focusSessions / 5, 0, 1) * 100;

  return Number(
    (
      0.4 * normalizedActiveTime +
      0.25 * revisitScore +
      0.2 * deepScrollScore +
      0.15 * interactionPauseScore
    ).toFixed(1)
  );
}

function computeCompletionScore(page) {
  const scrollCompletion = clamp(page.maxScrollPct, 0, 100);
  const paceMsPerPct = page.maxScrollPct > 0 ? page.activeMs / page.maxScrollPct : page.activeMs;
  const readPacing = clamp((paceMsPerPct - 500) / 4000, 0, 1) * 100;
  const returnAndFinish =
    page.returnAfter1hCount > 0 && page.maxScrollPct >= 65
      ? 100
      : clamp(page.returnAfter1hCount / 2, 0, 1) * 60;
  const timeDepth = clamp(page.activeMs / 240_000, 0, 1) * 100;

  return Number(
    (0.45 * scrollCompletion + 0.25 * readPacing + 0.2 * returnAndFinish + 0.1 * timeDepth).toFixed(1)
  );
}

function inferTaskTopic(componentPages) {
  const counts = new Map();

  for (const page of componentPages) {
    const domainParts = page.domain.split(".");
    const blocklist = new Set([...TOPIC_STOPWORDS, ...domainParts]);
    const tokens = [...page.queryTokens, ...page.semanticTokens];

    for (const token of tokens) {
      if (token.length < 3 || blocklist.has(token)) {
        continue;
      }
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!ranked.length) {
    return "";
  }

  const strong = ranked.filter(([, count]) => count >= 2).map(([token]) => token);
  if (strong.length >= 2) {
    return `${strong[0]} ${strong[1]}`;
  }

  if (strong.length === 1) {
    return strong[0];
  }

  if (ranked.length >= 2) {
    return `${ranked[0][0]} ${ranked[1][0]}`;
  }

  return ranked[0][0];
}

function taskTitleFor(category, primaryDomain, topic) {
  const topicText = topic ? topic.replace(/\s+/g, " ").trim() : "";

  if (category === "shopping") {
    return topicText ? `Compare ${topicText} options` : `Compare items on ${primaryDomain}`;
  }
  if (category === "travel") {
    return topicText ? `Plan trip for ${topicText}` : `Travel planning on ${primaryDomain}`;
  }
  if (category === "research") {
    return topicText ? `Research ${topicText}` : `Research on ${primaryDomain}`;
  }
  if (category === "social") {
    return topicText ? `Follow ${topicText} thread` : `Social thread on ${primaryDomain}`;
  }
  return topicText ? `Task: ${topicText}` : `Task around ${primaryDomain}`;
}

function generateBriefing(task) {
  const lead = task.confidence >= 0.8 ? "You were" : "It looks like you were";
  const { readCount, skimmedCount, bouncedCount, unopenedCount } = task.stats;
  const across = task.domains?.length ? ` across ${task.domains.slice(0, 3).join(", ")}` : "";
  const topicText = task.topic ? ` ${task.topic}` : "";

  if (task.category === "shopping") {
    return `${lead} comparing ${task.stats.pageCount}${topicText} shopping pages${across}. You read ${readCount}, skimmed ${skimmedCount}, and left ${unopenedCount} unopened.`;
  }

  if (task.category === "research") {
    return `${lead} researching across ${task.stats.pageCount}${topicText} pages${across}. You fully read ${readCount} and skimmed ${skimmedCount}.`;
  }

  if (task.category === "travel") {
    return `${lead} planning travel across ${task.stats.pageCount}${topicText} pages${across}. ${skimmedCount + unopenedCount} pages still look unfinished.`;
  }

  return `${lead} working across ${task.stats.pageCount}${topicText} related pages${across}. ${bouncedCount + unopenedCount} pages appear not fully reviewed.`;
}

function generateNextAction(task) {
  if (task.stats.unopenedCount > 0) {
    return "Open the unopened pages first, then continue in ranked order.";
  }
  if (task.stats.skimmedCount > 0) {
    return "Finish the skimmed pages to close this task.";
  }
  if (task.category === "shopping") {
    return "Double-check reviews and return policy before deciding.";
  }
  return "Mark this task done if you are finished.";
}

function componentConfidence(componentPages, edgeScores) {
  const sizeScore = clamp(componentPages.length / 5, 0, 1);
  const totalEvents = componentPages.reduce((sum, page) => sum + page.eventCount, 0);
  const activityScore = clamp(totalEvents / 40, 0, 1);
  const coherenceScore = edgeScores.length
    ? edgeScores.reduce((sum, value) => sum + value, 0) / edgeScores.length
    : 0.55;

  const confidence = 0.4 * coherenceScore + 0.35 * activityScore + 0.25 * sizeScore;
  return Number(clamp(confidence, 0.45, 0.95).toFixed(2));
}

function aggregatePages(events) {
  const pages = new Map();
  const sortedEvents = [...events].sort((a, b) => a.ts - b.ts);
  const estimatedActiveMsByUrl = new Map();
  const activeByWindow = new Map();

  const addEstimatedMs = (url, ms) => {
    if (!url || ms <= 0) {
      return;
    }
    estimatedActiveMsByUrl.set(url, (estimatedActiveMsByUrl.get(url) || 0) + ms);
  };

  for (const event of sortedEvents) {
    const url = canonicalizeUrl(event.url || "");
    if (!url) {
      if (event.event_type === "tab_removed") {
        const windowKey = String(event.window_id ?? "unknown");
        const active = activeByWindow.get(windowKey);
        if (active && active.tabId === event.tab_id) {
          addEstimatedMs(active.url, Math.max(0, event.ts - active.startTs));
          activeByWindow.delete(windowKey);
        }
      }
      continue;
    }

    const domain = safeDomain(url);
    if (domain === "unknown") {
      continue;
    }

    let page = pages.get(url);
    if (!page) {
      page = {
        url,
        domain,
        titleLatest: "",
        firstTs: event.ts,
        lastTs: event.ts,
        eventCount: 0,
        activeMs: 0,
        maxScrollPct: 0,
        snapshotCount: 0,
        deepScrollCount: 0,
        activationCount: 0,
        visitTimestamps: [],
        engagementTimestamps: []
      };
      pages.set(url, page);
    }

    page.eventCount += 1;
    page.lastTs = Math.max(page.lastTs, event.ts);
    page.firstTs = Math.min(page.firstTs, event.ts);

    if (event.title) {
      if (!isGenericTitle(event.title)) {
        page.titleLatest = event.title;
      }
    }

    if (event.event_type === "tab_activated") {
      const windowKey = String(event.window_id ?? "unknown");
      const prevActive = activeByWindow.get(windowKey);
      if (prevActive && prevActive.tabId !== event.tab_id) {
        addEstimatedMs(prevActive.url, Math.max(0, event.ts - prevActive.startTs));
      }
      activeByWindow.set(windowKey, {
        tabId: event.tab_id,
        url,
        startTs: event.ts
      });

      page.activationCount += 1;
      page.visitTimestamps.push(event.ts);
    }

    if (event.event_type === "tab_updated" || event.event_type === "nav_committed") {
      const windowKey = String(event.window_id ?? "unknown");
      const active = activeByWindow.get(windowKey);
      if (active && active.tabId === event.tab_id && active.url !== url) {
        addEstimatedMs(active.url, Math.max(0, event.ts - active.startTs));
        activeByWindow.set(windowKey, {
          tabId: event.tab_id,
          url,
          startTs: event.ts
        });
      }

      const lastVisitTs = page.visitTimestamps[page.visitTimestamps.length - 1] || 0;
      if (event.ts - lastVisitTs > 20_000) {
        page.visitTimestamps.push(event.ts);
      }
    }

    if (event.event_type === "engagement_snapshot") {
      const activeMs = Math.max(0, toNum(event.payload?.activeMsSinceLast, 0));
      const scrollPct = clamp(toNum(event.payload?.scrollPct, 0), 0, 100);
      page.activeMs += activeMs;
      page.maxScrollPct = Math.max(page.maxScrollPct, scrollPct);
      page.snapshotCount += 1;
      if (scrollPct >= 65) {
        page.deepScrollCount += 1;
      }
      if (activeMs > 0) {
        page.engagementTimestamps.push(event.ts);
      }
    }
  }

  const result = [];
  for (const page of pages.values()) {
    const semanticTokens = extractSemanticTokens(page.url, page.titleLatest);
    const queryTokens = extractQueryTokens(page.url);
    const topicTokens = extractTopicTokens(page.url, semanticTokens, queryTokens);
    const focusSessions = countSessions(page.engagementTimestamps, 60_000);
    const estimatedActiveMs = estimatedActiveMsByUrl.get(page.url) || 0;
    const blendedActiveMs = Math.max(page.activeMs, Math.round(estimatedActiveMs * 0.75));

    const visitCount = page.visitTimestamps.length;
    const revisitCount = Math.max(0, visitCount - 1);

    result.push({
      ...page,
      activeMs: blendedActiveMs,
      estimatedActiveMs,
      semanticTokens,
      queryTokens,
      topicTokens,
      categoryHint: classifyTaskCategory(`${page.titleLatest} ${page.url}`),
      isSearchLike: (() => {
        try {
          const parsed = new URL(page.url);
          return isSearchLikePath(parsed.pathname);
        } catch {
          return false;
        }
      })(),
      focusSessions,
      visitCount,
      revisitCount,
      returnAfter1hCount: countReturns(page.visitTimestamps, 60 * 60 * 1000),
      returnAfter24hCount: countReturns(page.visitTimestamps, 24 * 60 * 60 * 1000)
    });
  }

  return result;
}

function buildComponents(pages) {
  const n = pages.length;
  const adjacency = Array.from({ length: n }, () => []);
  const componentEdgeScores = [];

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const similarity = pageSimilarity(pages[i], pages[j]);
      if (similarity.score >= 0.55) {
        adjacency[i].push(j);
        adjacency[j].push(i);
        componentEdgeScores.push({ i, j, score: similarity.score });
      }
    }
  }

  const visited = new Array(n).fill(false);
  const components = [];

  for (let i = 0; i < n; i += 1) {
    if (visited[i]) {
      continue;
    }

    const stack = [i];
    visited[i] = true;
    const indexes = [];

    while (stack.length) {
      const current = stack.pop();
      indexes.push(current);
      for (const neighbor of adjacency[current]) {
        if (!visited[neighbor]) {
          visited[neighbor] = true;
          stack.push(neighbor);
        }
      }
    }

    components.push(indexes);
  }

  return { components, componentEdgeScores };
}

function buildTaskFromComponent(componentPages, edgeScores, taskOverrides) {
  const maxActiveMsInTask = Math.max(...componentPages.map((page) => page.activeMs), 1);
  const pages = componentPages.map((page) => {
    const completionScore = computeCompletionScore(page);
    const interestScore = computeInterestScore(page, maxActiveMsInTask);
    const state = classifyPageState(page, completionScore);

    return {
      url: page.url,
      domain: page.domain,
      title: page.titleLatest || page.url,
      state,
      interestScore,
      completionScore,
      maxScrollPct: Number(page.maxScrollPct.toFixed(1)),
      activeMs: page.activeMs,
      visitCount: page.visitCount,
      revisitCount: page.revisitCount,
      lastTs: page.lastTs
    };
  });

  pages.sort((a, b) => {
    if (b.interestScore !== a.interestScore) {
      return b.interestScore - a.interestScore;
    }
    return b.lastTs - a.lastTs;
  });

  const domainCounts = new Map();
  for (const page of pages) {
    domainCounts.set(page.domain, (domainCounts.get(page.domain) || 0) + 1);
  }

  const sortedDomains = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]);
  const primaryDomain = sortedDomains[0][0];
  const domains = sortedDomains.map(([domain]) => domain);
  const categoryText = pages.map((page) => `${page.title} ${page.url}`).join(" ");
  const category = classifyTaskCategory(categoryText);
  const confidence = componentConfidence(componentPages, edgeScores);
  const topic = inferTaskTopic(componentPages);

  const urls = pages.map((page) => page.url);
  const stableId = `task-${hashString(urls.slice().sort().join("|"))}`;
  const override = taskOverrides[stableId] || {};

  const stats = {
    pageCount: pages.length,
    eventCount: componentPages.reduce((sum, page) => sum + page.eventCount, 0),
    activeMs: componentPages.reduce((sum, page) => sum + page.activeMs, 0),
    revisitCount: componentPages.reduce((sum, page) => sum + page.revisitCount, 0),
    deepScrollCount: componentPages.reduce((sum, page) => sum + page.deepScrollCount, 0),
    readCount: pages.filter((page) => page.state === "read").length,
    skimmedCount: pages.filter((page) => page.state === "skimmed").length,
    bouncedCount: pages.filter((page) => page.state === "bounced").length,
    unopenedCount: pages.filter((page) => page.state === "unopened").length
  };

  const task = {
    taskId: stableId,
    title: override.title || taskTitleFor(category, primaryDomain, topic),
    domain: primaryDomain,
    domains,
    category,
    topic,
    confidence,
    status: override.done ? "done" : "active",
    lastActivityTs: Math.max(...componentPages.map((page) => page.lastTs)),
    urls,
    pages,
    stats,
    createdBy: "graph-clustering-v1"
  };

  task.briefing = generateBriefing(task);
  task.nextAction = generateNextAction(task);
  return task;
}

export function canonicalizeUrl(input) {
  try {
    const url = new URL(input);
    url.hostname = normalizeHost(url.hostname);
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";

    const searchLike = isSearchLikePath(url.pathname);
    const kept = [];
    for (const [rawKey, value] of url.searchParams.entries()) {
      const key = rawKey.toLowerCase();
      if (isTrackingParam(key)) {
        continue;
      }
      if (searchLike && !SEARCH_QUERY_KEYS.has(key)) {
        continue;
      }
      if (!searchLike && !NON_SEARCH_STABLE_PARAM_KEYS.has(key)) {
        continue;
      }
      if (value === "") {
        continue;
      }
      kept.push([key, value]);
    }

    kept.sort((a, b) => a[0].localeCompare(b[0]));
    url.search = "";
    for (const [key, value] of kept) {
      url.searchParams.append(key, value);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return input || "";
  }
}

export function safeDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export function buildTaskFeedFromEvents(events, options = {}) {
  const taskOverrides = options.taskOverrides || {};
  const includeDone = Boolean(options.includeDone);
  const limit = Math.max(1, toNum(options.limit, 50));

  const pages = aggregatePages(events);
  if (!pages.length) {
    return [];
  }

  const { components, componentEdgeScores } = buildComponents(pages);
  const mergedComponents = mergeComponentsHeuristically(components, pages);
  const refinedComponents = mergedComponents.flatMap((indexes) =>
    splitOutliersInComponent(indexes, pages)
  );

  const tasks = refinedComponents
    .map((indexes) => {
      const componentPages = indexes.map((index) => pages[index]);
      const edgeScores = componentEdgeScores
        .filter((edge) => indexes.includes(edge.i) && indexes.includes(edge.j))
        .map((edge) => edge.score);

      return buildTaskFromComponent(componentPages, edgeScores, taskOverrides);
    })
    .filter((task) => includeDone || task.status !== "done");

  tasks.sort((a, b) => {
    const aScore =
      a.stats.readCount * 2 +
      a.stats.skimmedCount +
      a.stats.unopenedCount * 1.2 +
      a.stats.revisitCount * 0.6 +
      a.confidence * 10;
    const bScore =
      b.stats.readCount * 2 +
      b.stats.skimmedCount +
      b.stats.unopenedCount * 1.2 +
      b.stats.revisitCount * 0.6 +
      b.confidence * 10;

    if (aScore !== bScore) {
      return bScore - aScore;
    }

    return b.lastActivityTs - a.lastActivityTs;
  });

  return tasks.slice(0, limit);
}
