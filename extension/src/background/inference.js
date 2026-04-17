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
  "post",
  "these",
  "those",
  "thing",
  "things",
  "option",
  "options",
  "around",
  "overview",
  "compare"
]);
const SEARCH_DOMAINS = new Set([
  "google.com",
  "bing.com",
  "duckduckgo.com",
  "search.yahoo.com",
  "ecosia.org"
]);
const TITLE_TOPIC_STOPWORDS = new Set([
  ...TOPIC_STOPWORDS,
  "option",
  "options",
  "compare",
  "comparison",
  "task",
  "thread",
  "work",
  "plan",
  "planning",
  "buy",
  "learn",
  "continue"
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

function overlapRatio(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) {
    return 0;
  }

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let common = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      common += 1;
    }
  }

  return common / Math.max(setA.size, setB.size);
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

function intentTokensForPage(page) {
  const source = page.isSearchLike ? page.queryTokens : page.topicTokens;
  const unique = new Set();
  for (const token of source || []) {
    if (token.length < 3 || TOPIC_STOPWORDS.has(token)) {
      continue;
    }
    unique.add(token);
  }
  return [...unique];
}

function formatDurationMinutes(activeMs) {
  const minutes = Math.max(1, Math.round(toNum(activeMs, 0) / 60_000));
  return `${minutes} min`;
}

function titleTopic(topic) {
  const tokens = tokenize(topic || "").filter((token) => !TITLE_TOPIC_STOPWORDS.has(token));
  if (!tokens.length) {
    return "";
  }
  return tokens.slice(0, 3).join(" ");
}

function statePriority(pageState) {
  if (pageState === "unopened") return 0;
  if (pageState === "skimmed") return 1;
  if (pageState === "bounced") return 2;
  return 3;
}

function queryFromUrl(url) {
  try {
    const parsed = new URL(url);
    const keys = ["q", "query", "k", "keyword", "keywords", "search_query", "field-keywords", "term", "p"];
    for (const key of keys) {
      const value = String(parsed.searchParams.get(key) || "").trim();
      if (value) {
        return value.replace(/\+/g, " ");
      }
    }
  } catch {
    // Ignore parsing errors.
  }
  return "";
}

function hasTaskSignal(taskTextParts, pattern) {
  return pattern.test(taskTextParts.join(" ").toLowerCase());
}

function pageSimilarity(pageA, pageB) {
  const semantic = jaccard(pageA.semanticTokens, pageB.semanticTokens);
  const topicOverlap = jaccard(pageA.topicTokens, pageB.topicTokens);
  const intentA = intentTokensForPage(pageA);
  const intentB = intentTokensForPage(pageB);
  const intentOverlap = jaccard(intentA, intentB);
  const sharedIntentCount = sharedTokenCount(intentA, intentB);

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
  const searchIntentBridge =
    (pageA.isSearchLike || pageB.isSearchLike) &&
    (sharedIntentCount >= 1 || queryOverlap >= 0.16 || topicOverlap >= 0.2)
      ? 0.12
      : 0;
  const searchMismatchPenalty =
    (pageA.isSearchLike || pageB.isSearchLike) &&
    sharedIntentCount === 0 &&
    intentOverlap < 0.06 &&
    queryOverlap < 0.06 &&
    topicOverlap < 0.08
      ? -0.34
      : 0;

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
    categoryAdjustment = -0.3;
  }

  return {
    score:
      0.22 * semantic +
      0.17 * domainOverlap +
      0.17 * temporalAdjacency +
      0.2 * topicOverlap +
      0.1 * queryOverlap +
      0.12 * intentOverlap +
      0.1 * revisitCooccurrence +
      topicTemporalBoost +
      searchIntentBridge +
      searchMismatchPenalty +
      categoryAdjustment,
    semantic,
    topicOverlap,
    domainOverlap,
    temporalAdjacency,
    queryOverlap,
    intentOverlap,
    sharedIntentCount,
    searchIntentBridge,
    searchMismatchPenalty,
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
  const intentTokens = [];
  let searchLikeCount = 0;
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = 0;

  for (const page of componentPages) {
    domainCounts.set(page.domain, (domainCounts.get(page.domain) || 0) + 1);
    semanticTokens.push(...page.semanticTokens);
    topicTokens.push(...page.topicTokens);
    queryTokens.push(...page.queryTokens);
    intentTokens.push(...intentTokensForPage(page));
    if (page.isSearchLike) {
      searchLikeCount += 1;
    }
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
    intentTokens,
    searchLikeCount,
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
  const intentOverlap = jaccard(sigA.intentTokens, sigB.intentTokens);
  const sharedIntent = sharedTokenCount(sigA.intentTokens, sigB.intentTokens);
  const isSearchHeavy = sigA.searchLikeCount > 0 || sigB.searchLikeCount > 0;

  if (
    isSearchHeavy &&
    sharedIntent === 0 &&
    intentOverlap < 0.05 &&
    queryOverlap < 0.08 &&
    topicOverlap < 0.1
  ) {
    return false;
  }

  if (sameDomain) {
    if (
      SEARCH_DOMAINS.has(sigA.primaryDomain) &&
      SEARCH_DOMAINS.has(sigB.primaryDomain) &&
      sharedIntent === 0 &&
      queryOverlap < 0.14 &&
      topicOverlap < 0.14
    ) {
      return false;
    }

    if (topicOverlap >= 0.1 || semanticOverlap >= 0.15 || queryOverlap >= 0.1) {
      return true;
    }

    if (
      temporalDistance <= 2 * 60 * 60 * 1000 &&
      (sharedIntent >= 1 || sharedTopics >= 1 || queryOverlap >= 0.06) &&
      (sigA.category === "other" || sigB.category === "other")
    ) {
      return true;
    }

    if (
      temporalDistance <= 20 * 60 * 1000 &&
      sigA.category === sigB.category &&
      sigA.category !== "other" &&
      (topicOverlap >= 0.08 || semanticOverlap >= 0.08 || queryOverlap >= 0.05 || intentOverlap >= 0.08)
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
    (
      sharedIntent >= 1 ||
      intentOverlap >= 0.06 ||
      sharedTopics >= 1 ||
      topicOverlap >= 0.04 ||
      semanticOverlap >= 0.06 ||
      queryOverlap >= 0.03
    )
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
    /shop|product|checkout|cart|jacket|dress|shirt|pants|shoe|sneaker|bag|soccer|ball|buy|price|reformation|gap|american eagle|zara|h&m|uniqlo|adidas|nike|bloomingdale|rent the runway|amazon/.test(
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

  if (/linkedin|indeed|greenhouse|lever\.co|job|career|resume|cv|interview/.test(haystack)) {
    return "job";
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

function estimateRemainingReadMs(page, completionScore) {
  const progressPct = clamp(
    Math.max(toNum(completionScore, 0), toNum(page.maxScrollPct, 0) * 0.85),
    0,
    100
  );
  if (progressPct >= 97) {
    return 0;
  }

  const activeMs = Math.max(0, toNum(page.activeMs, 0));
  const progressRatio = progressPct / 100;

  let totalEstimateMs = 0;
  if (progressRatio >= 0.08 && activeMs >= 10_000) {
    totalEstimateMs = activeMs / progressRatio;
  } else if (page.isSearchLike) {
    totalEstimateMs = 90_000;
  } else if (page.categoryHint === "shopping") {
    totalEstimateMs = 210_000;
  } else if (page.categoryHint === "research") {
    totalEstimateMs = 330_000;
  } else {
    totalEstimateMs = 240_000;
  }

  totalEstimateMs = clamp(totalEstimateMs, 60_000, 30 * 60_000);
  return Math.max(0, Math.round(totalEstimateMs - activeMs));
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
  const normalizedTopic = titleTopic(topic);

  if (category === "shopping") {
    return normalizedTopic ? `Buy ${normalizedTopic}` : `Buy item (${primaryDomain})`;
  }
  if (category === "travel") {
    return normalizedTopic ? `Plan trip: ${normalizedTopic}` : "Plan a trip";
  }
  if (category === "research") {
    return normalizedTopic ? `Learn about ${normalizedTopic}` : "Read and learn";
  }
  if (category === "social") {
    return normalizedTopic ? `Catch up on ${normalizedTopic}` : "Catch up on thread";
  }
  if (category === "job") {
    return normalizedTopic ? `Job search: ${normalizedTopic}` : "Job search task";
  }
  return normalizedTopic ? `Continue: ${normalizedTopic}` : "Continue browsing task";
}

function resolveTaskStatus(override, nowTs) {
  if (override?.status === "dropped") {
    return "dropped";
  }
  if (override?.status === "done" || override?.done === true) {
    return "done";
  }
  if (override?.status === "snoozed") {
    const untilTs = toNum(override?.snoozedUntilTs, 0);
    if (untilTs > nowTs) {
      return "snoozed";
    }
  }
  return "active";
}

function taskWorkflowState(task) {
  if (task.status === "done") return "completed";
  if (task.status === "dropped") return "dropped";
  if (task.status === "snoozed") return "snoozed";

  const { readCount, skimmedCount, unopenedCount, pageCount } = task.stats;
  if (task.category === "shopping") {
    if (pageCount <= 1) return "exploring options";
    if (readCount === 0) return "comparing options";
    if (unopenedCount > 0 || skimmedCount > 0) return "narrowing shortlist";
    return "ready to decide";
  }
  if (task.category === "research") {
    if (readCount === 0) return "scanning sources";
    if (readCount < 2) return "deep reading";
    return "synthesizing findings";
  }
  if (task.category === "travel") {
    if (unopenedCount > 0) return "gathering options";
    if (skimmedCount > 0) return "comparing itinerary";
    return "ready to book";
  }
  if (task.category === "job") {
    if (unopenedCount > 0) return "collecting roles";
    if (skimmedCount > 0) return "screening roles";
    return "ready to apply";
  }
  return "in progress";
}

function buildDecisionContext(task) {
  const pages = Array.isArray(task.pages) ? task.pages : [];
  const favored = pages[0] || null;
  const taskTextParts = [
    task.title,
    task.topic,
    ...task.urls,
    ...pages.map((page) => `${page.title} ${page.url}`)
  ];
  const missing = [];

  if (task.category === "shopping") {
    const hasReviews = hasTaskSignal(
      taskTextParts,
      /review|rating|customer\s*review|testimonials?/i
    );
    const hasPolicy = hasTaskSignal(taskTextParts, /return|refund|shipping|policy/i);
    const hasPrice = hasTaskSignal(taskTextParts, /\$|price|deal|discount|sale|under\s+\d+/i);
    if (!hasReviews) missing.push("No review check detected");
    if (!hasPolicy) missing.push("No return/shipping policy check detected");
    if (!hasPrice) missing.push("No clear price comparison detected");
  } else if (task.category === "travel") {
    const hasFlights = hasTaskSignal(taskTextParts, /flight|airline|google\s*flights|kayak|expedia/i);
    const hasHotels = hasTaskSignal(taskTextParts, /hotel|airbnb|booking\.com|accommodation|stay/i);
    if (!hasFlights) missing.push("Flights were not researched");
    if (!hasHotels) missing.push("Hotels/stays were not researched");
  } else if (task.category === "research") {
    if (task.stats.readCount === 0) {
      missing.push("No source was deeply read yet");
    }
    if ((task.domains || []).length < 2) {
      missing.push("Low source diversity");
    }
  } else if (task.stats.unopenedCount > 0) {
    missing.push(`${task.stats.unopenedCount} page(s) still unopened`);
  }

  if (!favored) {
    return {
      favoredLabel: "",
      reasons: [],
      missingSignals: missing
    };
  }

  const reasons = [];
  if (favored.activeMs > 0) reasons.push(`spent ${formatDurationMinutes(favored.activeMs)}`);
  if (favored.revisitCount > 0) reasons.push(`revisited ${favored.revisitCount}x`);
  if (favored.maxScrollPct >= 65) reasons.push(`scrolled ${Math.round(favored.maxScrollPct)}%`);
  if (!reasons.length) reasons.push("opened repeatedly");

  return {
    favoredLabel: favored.title || favored.url,
    reasons,
    missingSignals: missing
  };
}

function whyTimeline(componentPages) {
  const steps = [];
  const ordered = [...componentPages].sort((a, b) => a.firstTs - b.firstTs);
  if (!ordered.length) {
    return steps;
  }

  const searchPage = ordered.find((page) => {
    const query = queryFromUrl(page.url);
    if (query) {
      return true;
    }
    try {
      const parsed = new URL(page.url);
      const domain = parsed.hostname.replace(/^www\./, "");
      return SEARCH_DOMAINS.has(domain) || isSearchLikePath(parsed.pathname);
    } catch {
      return false;
    }
  });

  if (searchPage) {
    const query = queryFromUrl(searchPage.url);
    if (query) {
      steps.push(`Searched "${query}"`);
    } else {
      steps.push(`Started from ${searchPage.domain}`);
    }
  }

  const opened = ordered.filter((page) => page.url !== searchPage?.url).slice(0, 2);
  for (const page of opened) {
    steps.push(`Opened ${page.titleLatest || page.url}`);
  }

  const revisited = [...ordered]
    .filter((page) => page.revisitCount > 0)
    .sort((a, b) => b.revisitCount - a.revisitCount || b.lastTs - a.lastTs)[0];
  if (revisited) {
    steps.push(`Revisited ${revisited.titleLatest || revisited.url} (${revisited.revisitCount}x)`);
  }

  return steps.slice(0, 4);
}

function buildResumePlan(task) {
  const orderedPages = [...(task.pages || [])].sort((a, b) => {
    const stateDelta = statePriority(a.state) - statePriority(b.state);
    if (stateDelta !== 0) return stateDelta;
    if (b.interestScore !== a.interestScore) return b.interestScore - a.interestScore;
    return b.lastTs - a.lastTs;
  });

  const orderedUrls = orderedPages.map((page) => page.url).filter(Boolean);
  const checklist = [];

  if (task.category === "shopping") {
    checklist.push("Open shortlist pages in ranked order");
    checklist.push("Check reviews + return/shipping for top options");
    checklist.push("Decide: mark done or set a reminder");
  } else if (task.category === "travel") {
    checklist.push("Review unfinished options first");
    checklist.push("Cover missing side: flights and stays");
    checklist.push("Set next milestone or mark done");
  } else if (task.category === "research") {
    checklist.push("Finish skimmed/unopened sources first");
    checklist.push("Deep-read one source and capture key takeaway");
    checklist.push("Decide whether to continue or close");
  } else if (task.category === "job") {
    checklist.push("Open unfinished job pages first");
    checklist.push("Shortlist top roles and note requirements");
    checklist.push("Apply or set reminder");
  } else {
    checklist.push("Open unfinished pages first");
    checklist.push("Continue in ranked order");
    checklist.push("Mark done or set a reminder");
  }

  return {
    orderedUrls,
    orderedPages: orderedPages.slice(0, 6).map((page) => ({
      url: page.url,
      title: page.title,
      state: page.state
    })),
    checklist
  };
}

function buildTaskAdapter(task, componentPages) {
  if (task.category === "shopping") {
    const optionPages = (task.pages || [])
      .filter((page) => {
        try {
          const parsed = new URL(page.url);
          const domain = parsed.hostname.replace(/^www\./, "");
          return !SEARCH_DOMAINS.has(domain) && !isSearchLikePath(parsed.pathname);
        } catch {
          return true;
        }
      })
      .slice(0, 4)
      .map((page) => ({
        title: page.title,
        domain: page.domain,
        state: page.state,
        interestScore: page.interestScore
      }));

    const text = [
      task.title,
      task.topic,
      ...task.urls,
      ...(task.pages || []).map((page) => `${page.title} ${page.url}`)
    ].join(" ");

    return {
      type: "shopping",
      options: optionPages,
      checks: {
        reviews: /review|rating|customer\s*review|testimonials?/i.test(text),
        returnPolicy: /return|refund|shipping|policy/i.test(text),
        price: /\$|price|deal|discount|sale|under\s+\d+/i.test(text)
      }
    };
  }

  if (task.category === "travel") {
    const text = [
      task.title,
      task.topic,
      ...task.urls,
      ...(task.pages || []).map((page) => `${page.title} ${page.url}`)
    ].join(" ");
    return {
      type: "travel",
      checks: {
        flights: /flight|airline|google\s*flights|kayak|expedia/i.test(text),
        hotels: /hotel|airbnb|booking\.com|accommodation|stay/i.test(text),
        itinerary: /itinerary|schedule|day\s+\d+/i.test(text)
      }
    };
  }

  if (task.category === "research") {
    const sources = [...new Set(componentPages.map((page) => page.domain))];
    return {
      type: "research",
      sourceCount: sources.length,
      deepReadCount: task.stats.readCount
    };
  }

  if (task.category === "job") {
    const text = [
      task.title,
      task.topic,
      ...task.urls,
      ...(task.pages || []).map((page) => `${page.title} ${page.url}`)
    ].join(" ");
    return {
      type: "job",
      checks: {
        roleRequirements: /requirements|qualification|experience|responsibilit/i.test(text),
        compensation: /salary|compensation|pay|benefits/i.test(text),
        application: /apply|application|submit/i.test(text)
      }
    };
  }

  return { type: "generic" };
}

function detectDeadEnd(task) {
  const loopRevisits = (task.pages || [])
    .filter((page) => page.revisitCount >= 2 && page.completionScore < 45)
    .reduce((sum, page) => sum + page.revisitCount, 0);
  const repetitiveSearchPages = (task.pages || []).filter((page) => {
    try {
      const parsed = new URL(page.url);
      const domain = parsed.hostname.replace(/^www\./, "");
      return (
        (SEARCH_DOMAINS.has(domain) || isSearchLikePath(parsed.pathname)) &&
        page.revisitCount >= 2 &&
        page.completionScore < 40
      );
    } catch {
      return false;
    }
  }).length;

  const detected =
    loopRevisits >= 5 || (repetitiveSearchPages >= 2 && task.stats.readCount === 0);
  if (!detected) {
    return { detected: false, message: "", resetPlan: [] };
  }

  return {
    detected: true,
    message: "You appear to be looping through similar pages without reaching a decision.",
    resetPlan: [
      "Pick top 2 pages only",
      "Check one missing signal",
      "Decide: mark done or set a reminder"
    ]
  };
}

function generateBriefing(task) {
  const decision = task.decisionContext || { favoredLabel: "", reasons: [], missingSignals: [] };
  const favored = decision.favoredLabel ? `"${decision.favoredLabel}"` : "one page";
  const reasonText = decision.reasons.length ? decision.reasons.join(", ") : "engagement signals";
  const missing = decision.missingSignals[0] ? ` Missing signal: ${decision.missingSignals[0]}.` : "";

  if (task.category === "shopping") {
    return `You favored ${favored} because you ${reasonText}.${missing}`;
  }
  if (task.category === "research") {
    return `You focused most on ${favored} based on ${reasonText}.${missing}`;
  }
  if (task.category === "travel") {
    return `You concentrated on ${favored} while planning. ${missing || "You still have unfinished planning pages."}`;
  }
  if (task.category === "job") {
    return `You spent most effort on ${favored} (${reasonText}).${missing}`;
  }
  return `You were working across related pages and favored ${favored} (${reasonText}).${missing}`;
}

function generateNextAction(task) {
  if (task.deadEnd?.detected) {
    return "You are in a loop. Limit to top 2 pages, check one missing signal, then close or set a reminder.";
  }
  if (task.resumePlan?.checklist?.length) {
    return task.resumePlan.checklist[0];
  }
  return "Open unfinished pages, continue in order, then close the task.";
}

function tokensForTask(task) {
  const tokens = new Set();
  const textChunks = [
    task.title,
    task.topic,
    ...(task.pages || []).map((page) => `${page.title || ""} ${page.url || ""}`)
  ];
  for (const chunk of textChunks) {
    for (const token of tokenize(chunk)) {
      if (token.length < 3 || TOPIC_STOPWORDS.has(token)) {
        continue;
      }
      tokens.add(token);
    }
  }
  return tokens;
}

function relatedOverlapScore(taskA, taskB, tokenSetA, tokenSetB) {
  const domainsA = new Set([taskA.domain, ...(taskA.domains || [])].filter(Boolean));
  const domainsB = new Set([taskB.domain, ...(taskB.domains || [])].filter(Boolean));
  let sharedDomains = 0;
  for (const domain of domainsA) {
    if (domainsB.has(domain)) {
      sharedDomains += 1;
    }
  }

  const overlap = overlapRatio([...tokenSetA], [...tokenSetB]);
  let sharedTokens = 0;
  for (const token of tokenSetA) {
    if (tokenSetB.has(token)) {
      sharedTokens += 1;
    }
  }

  return {
    score:
      overlap +
      (sharedDomains > 0 ? 0.22 : 0) +
      (sharedTokens >= 2 ? 0.15 : 0) +
      (taskA.category === taskB.category ? 0.08 : 0),
    sharedDomains,
    sharedTokens
  };
}

function annotateRelatedTasks(tasks) {
  const tokenSets = new Map(tasks.map((task) => [task.taskId, tokensForTask(task)]));

  for (const task of tasks) {
    const related = [];
    const taskTokens = tokenSets.get(task.taskId) || new Set();

    for (const candidate of tasks) {
      if (candidate.taskId === task.taskId) {
        continue;
      }
      const candidateTokens = tokenSets.get(candidate.taskId) || new Set();
      const recencyGapMs = toNum(task.lastActivityTs, 0) - toNum(candidate.lastActivityTs, 0);
      if (recencyGapMs < 30 * 60 * 1000) {
        continue;
      }

      const relation = relatedOverlapScore(task, candidate, taskTokens, candidateTokens);
      if (relation.score < 0.34) {
        continue;
      }

      related.push({
        taskId: candidate.taskId,
        title: candidate.title,
        domain: candidate.domain,
        category: candidate.category,
        lastActivityTs: candidate.lastActivityTs,
        overlapScore: Number(relation.score.toFixed(2)),
        reason:
          relation.sharedDomains > 0
            ? "shared domain + intent overlap"
            : relation.sharedTokens >= 2
              ? "shared intent keywords"
              : "similar browsing thread"
      });
    }

    related.sort((a, b) => {
      if (b.overlapScore !== a.overlapScore) {
        return b.overlapScore - a.overlapScore;
      }
      return b.lastActivityTs - a.lastActivityTs;
    });
    task.relatedTasks = related.slice(0, 2);
  }

  return tasks;
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

function buildTaskFromComponent(componentPages, edgeScores, taskOverrides, nowTs) {
  const maxActiveMsInTask = Math.max(...componentPages.map((page) => page.activeMs), 1);
  const pages = componentPages.map((page) => {
    const completionScore = computeCompletionScore(page);
    const interestScore = computeInterestScore(page, maxActiveMsInTask);
    const state = classifyPageState(page, completionScore);
    const readingProgressPct = Number(
      clamp(Math.max(completionScore, page.maxScrollPct * 0.85), 0, 100).toFixed(1)
    );
    const remainingReadMs = estimateRemainingReadMs(page, completionScore);

    return {
      url: page.url,
      domain: page.domain,
      title: page.titleLatest || page.url,
      state,
      interestScore,
      completionScore,
      readingProgressPct,
      remainingReadMs,
      remainingReadMin: Math.max(0, Math.round(remainingReadMs / 60_000)),
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
  const avgReadingProgressPct = pages.length
    ? Number(
      (pages.reduce((sum, page) => sum + toNum(page.readingProgressPct, 0), 0) / pages.length).toFixed(1)
    )
    : 0;
  const estimatedRemainingReadMs = pages.reduce((sum, page) => sum + toNum(page.remainingReadMs, 0), 0);

  const status = resolveTaskStatus(override, nowTs);

  const task = {
    taskId: stableId,
    title: override.title || taskTitleFor(category, primaryDomain, topic),
    domain: primaryDomain,
    domains,
    category,
    topic,
    confidence,
    status,
    snoozedUntilTs: toNum(override.snoozedUntilTs, 0),
    lastActivityTs: Math.max(...componentPages.map((page) => page.lastTs)),
    urls,
    pages,
    stats,
    avgReadingProgressPct,
    estimatedRemainingReadMs,
    estimatedRemainingReadMin: Math.max(0, Math.round(estimatedRemainingReadMs / 60_000)),
    createdBy: "graph-clustering-v1"
  };

  task.workflowState = taskWorkflowState(task);
  task.timeline = whyTimeline(componentPages);
  task.decisionContext = buildDecisionContext(task);
  task.resumePlan = buildResumePlan(task);
  task.deadEnd = detectDeadEnd(task);
  task.adapter = buildTaskAdapter(task, componentPages);
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
  const nowTs = toNum(options.nowTs, Date.now());

  const pages = aggregatePages(events);
  if (!pages.length) {
    return [];
  }

  const { components, componentEdgeScores } = buildComponents(pages);
  const mergedComponents = mergeComponentsHeuristically(components, pages);
  const refinedComponents = mergedComponents.flatMap((indexes) =>
    splitOutliersInComponent(indexes, pages)
  );

  const allTasks = refinedComponents
    .map((indexes) => {
      const componentPages = indexes.map((index) => pages[index]);
      const edgeScores = componentEdgeScores
        .filter((edge) => indexes.includes(edge.i) && indexes.includes(edge.j))
        .map((edge) => edge.score);

      return buildTaskFromComponent(componentPages, edgeScores, taskOverrides, nowTs);
    });

  const annotatedTasks = annotateRelatedTasks(allTasks);
  const tasks = annotatedTasks.filter((task) => includeDone || task.status === "active");

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

function dayKeyLocal(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDurationHuman(ms) {
  const totalMin = Math.max(0, Math.round(toNum(ms, 0) / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function queryForSearch(url) {
  try {
    const parsed = new URL(url);
    for (const key of SEARCH_QUERY_KEYS) {
      const value = String(parsed.searchParams.get(key) || "").trim();
      if (value) {
        return value.toLowerCase().replace(/\+/g, " ").replace(/\s+/g, " ").trim();
      }
    }
  } catch {
    // Ignore invalid URLs.
  }
  return "";
}

function topCategories(byCategoryMs, totalActiveMs, limit = 4) {
  const entries = Object.entries(byCategoryMs || {})
    .filter(([, ms]) => ms > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([category, ms]) => ({
      category,
      activeMs: ms,
      pct: totalActiveMs > 0 ? Number(((ms / totalActiveMs) * 100).toFixed(1)) : 0
    }));
  return entries;
}

function summarizeDaySemantically(day) {
  const top = topCategories(day.byCategoryMs, day.totalActiveMs, 3);
  if (!top.length) {
    return "No meaningful activity captured this day.";
  }

  const categoryText = top
    .map((item) => `${item.category} (${Math.round(item.pct)}%)`)
    .join(", ");
  return `You spent ${formatDurationHuman(day.totalActiveMs)} mostly on ${categoryText}.`;
}

function evaluateTimeSinks(day) {
  const sinks = [];
  const total = Math.max(1, day.totalActiveMs);
  const socialMs = toNum(day.byCategoryMs.social, 0);
  const otherMs = toNum(day.byCategoryMs.other, 0);
  const bouncedMs = toNum(day.bouncedMs, 0);

  if (socialMs / total >= 0.3) {
    sinks.push({
      label: "High social-feed time",
      detail: `${formatDurationHuman(socialMs)} spent on social pages.`,
      activeMs: socialMs
    });
  }

  if (bouncedMs / total >= 0.25 || day.bouncedPageCount >= 6) {
    sinks.push({
      label: "Frequent quick-close browsing",
      detail: `${day.bouncedPageCount} pages were closed quickly (${formatDurationHuman(bouncedMs)}).`,
      activeMs: bouncedMs
    });
  }

  if (day.searchLoopCount >= 3) {
    sinks.push({
      label: "Repeated search loops",
      detail: `${day.searchLoopCount} search pages were revisited without deep completion.`,
      activeMs: 0
    });
  }

  if (otherMs / total >= 0.4) {
    sinks.push({
      label: "Unclear-intent browsing",
      detail: `${formatDurationHuman(otherMs)} was in mixed/unclear browsing.`,
      activeMs: otherMs
    });
  }

  return sinks.slice(0, 4);
}

function buildCoachingLine(day, sinks) {
  if (!sinks.length) {
    return "Focus looked healthy. Keep closing tasks with Mark Done or Remind.";
  }

  const first = sinks[0]?.label || "";
  if (first.includes("search")) {
    return "Try a two-tab rule: pick top 2 options, then decide instead of re-searching.";
  }
  if (first.includes("quick-close")) {
    return "Open fewer tabs at once and finish one branch before opening a new one.";
  }
  if (first.includes("social")) {
    return "Set a short social timer before switching back to active tasks.";
  }
  return "Use Guided Resume to finish one open loop before starting a new thread.";
}

export function buildDailySemanticsFromEvents(events, options = {}) {
  const days = Math.max(1, Math.min(30, toNum(options.days, 7)));
  const nowTs = toNum(options.nowTs, Date.now());
  const cutoffTs = nowTs - days * 24 * 60 * 60 * 1000;
  const relevant = (events || []).filter((event) => toNum(event.ts, 0) >= cutoffTs);
  const dayBuckets = new Map();

  for (const event of relevant) {
    const ts = toNum(event.ts, 0);
    const key = dayKeyLocal(ts);
    let bucket = dayBuckets.get(key);
    if (!bucket) {
      bucket = {
        day: key,
        totalActiveMs: 0,
        byCategoryMs: {
          shopping: 0,
          research: 0,
          travel: 0,
          social: 0,
          job: 0,
          other: 0
        },
        events: [],
        searchQueries: new Map(),
        bouncedPageCount: 0,
        bouncedMs: 0,
        searchLoopCount: 0,
        topTasks: []
      };
      dayBuckets.set(key, bucket);
    }

    bucket.events.push(event);

    if (event.event_type === "engagement_snapshot") {
      const activeMs = Math.max(0, toNum(event.payload?.activeMsSinceLast, 0));
      const category = classifyTaskCategory(`${event.title || ""} ${event.url || ""}`);
      bucket.totalActiveMs += activeMs;
      if (bucket.byCategoryMs[category] === undefined) {
        bucket.byCategoryMs.other += activeMs;
      } else {
        bucket.byCategoryMs[category] += activeMs;
      }
    }

    if (event.url) {
      const query = queryForSearch(event.url);
      if (query) {
        bucket.searchQueries.set(query, (bucket.searchQueries.get(query) || 0) + 1);
      }
    }
  }

  const summaries = [];
  for (const bucket of dayBuckets.values()) {
    const pages = aggregatePages(bucket.events);
    const maxActiveMsInDay = Math.max(...pages.map((page) => page.activeMs), 1);

    for (const page of pages) {
      const completion = computeCompletionScore(page);
      const state = classifyPageState(page, completion);
      if (state === "bounced") {
        bucket.bouncedPageCount += 1;
        bucket.bouncedMs += page.activeMs;
      }
      if (page.isSearchLike && page.revisitCount >= 2 && completion < 40) {
        bucket.searchLoopCount += 1;
      }
      computeInterestScore(page, maxActiveMsInDay);
    }

    const dayTasks = buildTaskFeedFromEvents(bucket.events, {
      limit: 5,
      includeDone: true,
      nowTs
    });
    bucket.topTasks = dayTasks.slice(0, 3).map((task) => task.title);

    const sinks = evaluateTimeSinks(bucket);
    summaries.push({
      day: bucket.day,
      totalActiveMs: bucket.totalActiveMs,
      byCategoryMs: bucket.byCategoryMs,
      topCategories: topCategories(bucket.byCategoryMs, bucket.totalActiveMs, 5),
      semanticSummary: summarizeDaySemantically(bucket),
      likelyTimeSinks: sinks,
      coaching: buildCoachingLine(bucket, sinks),
      topTasks: bucket.topTasks,
      stats: {
        bouncedPageCount: bucket.bouncedPageCount,
        searchLoopCount: bucket.searchLoopCount,
        searchQueryCount: bucket.searchQueries.size
      }
    });
  }

  summaries.sort((a, b) => b.day.localeCompare(a.day));
  return summaries.slice(0, days);
}
