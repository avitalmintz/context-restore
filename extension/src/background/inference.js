const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAM_KEYS = new Set(["fbclid", "gclid", "mc_cid", "mc_eid", "fbvar"]);
const SEARCH_QUERY_KEYS = new Set([
  "q", "k", "keyword", "keywords", "query", "search_query", "field-keywords", "p", "term"
]);
const NON_SEARCH_STABLE_PARAM_KEYS = new Set([
  "id", "itemid", "item_id", "productid", "product_id", "pid", "sku", "asin"
]);
const GENERIC_TITLES = new Set(["new tab", "tab", "google chrome", "chrome"]);
const TOPIC_STOPWORDS = new Set([
  "www", "com", "https", "http", "search", "product", "products", "item", "items",
  "shop", "store", "page", "pages", "home", "official", "index", "title", "new",
  "best", "sale", "with", "from", "this", "that", "your", "for", "and", "the",
  "you", "tab", "browse", "thread", "chrome", "google", "results", "result",
  "paper", "article", "blog", "post", "these", "those", "thing", "things",
  "option", "options", "around", "overview", "compare"
]);
const TITLE_TOPIC_STOPWORDS = new Set([
  ...TOPIC_STOPWORDS,
  "comparison", "task", "work", "plan", "planning", "buy", "learn", "continue"
]);
const SEARCH_DOMAINS = new Set([
  "google.com", "bing.com", "duckduckgo.com", "search.yahoo.com", "ecosia.org"
]);
const ALWAYS_KEEP_TOKENS = new Set([
  "ai", "ml", "ux", "ui", "ar", "vr", "iot", "css", "js", "ts", "go", "py", "os", "ip", "sql", "api", "llm", "gpt", "rag"
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isGenericTitle(title) {
  const normalized = String(title || "").trim().toLowerCase();
  return !normalized || GENERIC_TITLES.has(normalized);
}

function normalizeToken(rawToken) {
  let token = String(rawToken || "").toLowerCase();
  if (!token || /^\d+$/.test(token)) return "";
  if (ALWAYS_KEEP_TOKENS.has(token)) return token;
  if (token.endsWith("ies") && token.length > 4) token = `${token.slice(0, -3)}y`;
  else if (token.endsWith("s") && token.length > 4 && !token.endsWith("ss")) token = token.slice(0, -1);
  if (token.length < 3) return "";
  return token;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .split(/[^a-z0-9]+/)
    .map(normalizeToken)
    .filter(Boolean);
}

function jaccard(a, b) {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union ? intersection / union : 0;
}

function sharedTokenCount(a, b) {
  const setA = new Set(a || []);
  const setB = new Set(b || []);
  let count = 0;
  for (const t of setA) if (setB.has(t)) count += 1;
  return count;
}

function sameBaseDomain(a, b) {
  const partsA = String(a || "").split(".").filter(Boolean);
  const partsB = String(b || "").split(".").filter(Boolean);
  if (partsA.length < 2 || partsB.length < 2) return false;
  return partsA.slice(-2).join(".") === partsB.slice(-2).join(".");
}

function normalizeHost(hostname) {
  return String(hostname || "").toLowerCase().replace(/^www\./, "");
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
  if (TRACKING_PARAM_KEYS.has(key)) return true;
  if (TRACKING_PARAM_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  return (
    key.startsWith("ref") || key.startsWith("fb_") || key.startsWith("ga_") ||
    key.startsWith("gbraid") || key.startsWith("wbraid") || key.startsWith("gad_") ||
    key.startsWith("spm") || key.startsWith("sc_") || key.startsWith("session")
  );
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
      if (isTrackingParam(key)) continue;
      if (searchLike && !SEARCH_QUERY_KEYS.has(key)) continue;
      if (!searchLike && !NON_SEARCH_STABLE_PARAM_KEYS.has(key)) continue;
      if (value === "") continue;
      kept.push([key, value]);
    }
    kept.sort((a, b) => a[0].localeCompare(b[0]));
    url.search = "";
    for (const [key, value] of kept) url.searchParams.append(key, value);
    url.hash = "";
    return url.toString();
  } catch {
    return input || "";
  }
}

function safeDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function extractQueryTokens(urlString) {
  try {
    const url = new URL(urlString);
    const tokens = [];
    for (const [, value] of url.searchParams.entries()) tokens.push(...tokenize(value));
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
      (t) => !domainParts.has(t) && !TOPIC_STOPWORDS.has(t)
    );
  } catch {
    return [...new Set(titleTokens)].filter((t) => !TOPIC_STOPWORDS.has(t));
  }
}

function extractTopicTokens(urlString, semanticTokens = [], queryTokens = []) {
  try {
    const url = new URL(urlString);
    const domainParts = new Set(url.hostname.split(".").filter(Boolean));
    const unique = new Set();
    for (const t of [...queryTokens, ...semanticTokens]) {
      if (t.length < 3 || domainParts.has(t) || TOPIC_STOPWORDS.has(t)) continue;
      unique.add(t);
    }
    return [...unique];
  } catch {
    return [...new Set([...queryTokens, ...semanticTokens])].filter(
      (t) => t.length >= 3 && !TOPIC_STOPWORDS.has(t)
    );
  }
}

function intentTokensForPage(page) {
  const source = page.isSearchLike ? page.queryTokens : page.topicTokens;
  const unique = new Set();
  for (const t of source || []) {
    if (t.length < 3 || TOPIC_STOPWORDS.has(t)) continue;
    unique.add(t);
  }
  return [...unique];
}

function classifyTaskCategory(text) {
  const haystack = ` ${text.toLowerCase()} `;

  if (/\b(ai|ml|llm|gpt|claude|anthropic|openai|chatgpt|gemini|midjourney|deepmind|huggingface|hugging\s*face|stable\s*diffusion|machine\s*learning|neural\s*net|transformer|agentic|fine[-\s]*tun|inference|rag)\b/.test(haystack)) {
    return "ai";
  }

  if (
    /(reformation|aritzia|lululemon|abercrombie|everlane|madewell|patagonia|anthropologie|freepeople|aerie\.|jcrew|j-crew|nordstrom|saks|wayfair|sephora|ulta|glossier|farfetch|ssense|frame-store|shopbop|revolve\.|asos\.|boohoo|amazon\.|etsy\.|ebay\.|shopify|zara\.|uniqlo|adidas|nike\.|bloomingdale|target\.com|walmart\.com|ikea\.com|hm\.com|h-m\.com|stradivarius|cos-stores|arket\.|gap\.com|oldnavy|bananarepublic|coach\.com|katespade|michaelkors|ralph\s*lauren|tory\s*burch|net-a-porter|matchesfashion|moda\s*operandi)/.test(haystack) ||
    /\b(checkout|cart|products?|jackets?|dresses?|shirts?|pants?|shoes?|sneakers?|bags?|sales?|catalog|workwear|outfits?)\b/.test(haystack)
  ) return "shopping";

  if (
    /(netflix\.|hbomax|hbo\.com|hbo\.go|hulu\.|disneyplus|disney\+|primevideo|peacocktv|appletv\.|paramount\+|paramountplus|max\.com|spotify\.|apple\.com\/music|tidal\.com|deezer\.|soundcloud)/.test(haystack) ||
    /\b(movies?|films?|imdb|trailers?|episodes?|series|podcasts?|playlists?)\b/.test(haystack)
  ) return "entertainment";

  if (
    /(wsj\.com|nytimes\.com|theguardian|guardian\.com|ft\.com|bbc\.|bloomberg\.|reuters\.|cnn\.|npr\.|axios\.|politico\.|techcrunch|theverge|verge\.com|wired\.|economist|businessinsider|forbes\.|theatlantic|newyorker|washingtonpost|usatoday|latimes|chicagotribune)/.test(haystack) ||
    /\b(news|articles?|reporters?|reporting|headlines?)\b/.test(haystack)
  ) return "news";

  if (
    /(github\.|gitlab\.|stackoverflow|stack-overflow|npmjs\.|pypi\.|crates\.io|developer\.|kubernetes|docker\.|aws\.amazon|cloud\.google|azure\.microsoft|terraform\.|webpack|vite\.|nextjs|react\.dev|vuejs|svelte\.dev)/.test(haystack) ||
    /\b(programming|developer|javascript|typescript|python|rust|golang|nodejs|django|flask|graphql|api)\b/.test(haystack)
  ) return "dev";

  if (
    /(arxiv\.|scholar\.google|pubmed|jstor|researchgate|biorxiv|ssrn)/.test(haystack) ||
    /\b(papers?|preprints?|whitepapers?|journals?|stud(?:y|ies)|abstracts?|citations?)\b/.test(haystack)
  ) return "research";

  if (
    /(airbnb\.|booking\.com|kayak\.|expedia\.|tripadvisor|hotels\.com|priceline|vrbo\.|skyscanner|hostelworld)/.test(haystack) ||
    /\b(flights?|airlines?|hotels?|trips?|travel|itinerary|vacations?|hostels?)\b/.test(haystack)
  ) return "travel";

  if (/(reddit\.|twitter\.|x\.com|instagram\.|tiktok\.|youtube\.|facebook\.|threads\.|mastodon|bluesky|hackernews|news\.ycombinator)/.test(haystack)) {
    return "social";
  }

  if (
    /(linkedin\.|indeed\.|greenhouse\.|lever\.co|workday\.|glassdoor|ashbyhq)/.test(haystack) ||
    /\b(careers?|resume|cv|interview|hiring|recruiters?|postings?)\b/.test(haystack)
  ) return "job";

  if (
    /(robinhood|fidelity|vanguard|coinbase|kraken\.|binance|etrade|schwab\.|wealthfront|betterment|sofi\.|chase\.com|bankofamerica|citibank|capitalone|wellsfargo|investing\.com|seekingalpha)/.test(haystack) ||
    /\b(invest|stocks?|crypto|bitcoin|ethereum|portfolios?|brokers?|brokerage|trading|earnings|dividends?)\b/.test(haystack)
  ) return "finance";

  if (
    /(yelp\.|opentable|doordash|ubereats|grubhub|seamless\.|tasty\.co|allrecipes|seriouseats|bonappetit)/.test(haystack) ||
    /\b(recipes?|cooking|baking|restaurants?|menus?|cuisine|chefs?|grocer(?:y|ies))\b/.test(haystack)
  ) return "food";

  if (
    /(webmd\.|mayoclinic|healthline|nih\.gov|cdc\.gov|peloton\.|strava\.|myfitnesspal)/.test(haystack) ||
    /\b(symptoms?|doctors?|hospitals?|clinics?|fitness|workouts?|exercise|nutrition|wellness|medication)\b/.test(haystack)
  ) return "health";

  return "other";
}

function pageFromTab(tab) {
  const url = canonicalizeUrl(tab.url || "");
  const domain = safeDomain(url);
  const title = isGenericTitle(tab.title) ? "" : (tab.title || "");
  const semanticTokens = extractSemanticTokens(url, title);
  const queryTokens = extractQueryTokens(url);
  const topicTokens = extractTopicTokens(url, semanticTokens, queryTokens);
  let isSearchLike = false;
  try {
    isSearchLike = isSearchLikePath(new URL(url).pathname);
  } catch {
    isSearchLike = false;
  }
  const lastTs = Number(tab.lastAccessed) || Date.now();

  return {
    tabId: tab.id,
    url,
    domain,
    title,
    semanticTokens,
    queryTokens,
    topicTokens,
    isSearchLike,
    categoryHint: classifyTaskCategory(`${title} ${url}`),
    lastTs
  };
}

function pageSimilarity(a, b) {
  const semantic = jaccard(a.semanticTokens, b.semanticTokens);
  const topicOverlap = jaccard(a.topicTokens, b.topicTokens);
  const intentA = intentTokensForPage(a);
  const intentB = intentTokensForPage(b);
  const intentOverlap = jaccard(intentA, intentB);
  const sharedIntent = sharedTokenCount(intentA, intentB);
  const queryOverlap = jaccard(a.queryTokens, b.queryTokens);

  let domainOverlap = 0;
  if (a.domain === b.domain) {
    domainOverlap = topicOverlap >= 0.1 ? 1 : 0.25;
  } else if (sameBaseDomain(a.domain, b.domain)) {
    domainOverlap = 0.6;
  }

  const diffMs = Math.abs(a.lastTs - b.lastTs);
  const fortyFiveMin = 45 * 60 * 1000;
  const twoHours = 2 * 60 * 60 * 1000;
  let temporal = 0;
  if (diffMs <= fortyFiveMin) temporal = 1;
  else if (diffMs <= twoHours) temporal = 1 - (diffMs - fortyFiveMin) / (twoHours - fortyFiveMin);

  const searchIntentBridge =
    (a.isSearchLike || b.isSearchLike) &&
    (sharedIntent >= 1 || queryOverlap >= 0.16 || topicOverlap >= 0.2)
      ? 0.12
      : 0;
  const searchMismatchPenalty =
    (a.isSearchLike || b.isSearchLike) &&
    sharedIntent === 0 &&
    intentOverlap < 0.06 &&
    queryOverlap < 0.06 &&
    topicOverlap < 0.08
      ? -0.34
      : 0;

  let categoryAdjustment = 0;
  if (a.categoryHint === b.categoryHint && a.categoryHint !== "other") {
    categoryAdjustment = 0.28;
  } else if (
    a.categoryHint !== b.categoryHint &&
    a.categoryHint !== "other" &&
    b.categoryHint !== "other"
  ) {
    categoryAdjustment = -0.25;
  }

  const score =
    0.26 * semantic +
    0.22 * domainOverlap +
    0.24 * topicOverlap +
    0.12 * queryOverlap +
    0.14 * intentOverlap +
    0.08 * temporal +
    searchIntentBridge +
    searchMismatchPenalty +
    categoryAdjustment;

  return clamp(score, -1, 2);
}

function buildComponents(pages, threshold) {
  const n = pages.length;
  const adjacency = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (pageSimilarity(pages[i], pages[j]) >= threshold) {
        adjacency[i].push(j);
        adjacency[j].push(i);
      }
    }
  }

  const visited = new Array(n).fill(false);
  const components = [];
  for (let i = 0; i < n; i += 1) {
    if (visited[i]) continue;
    const stack = [i];
    visited[i] = true;
    const indexes = [];
    while (stack.length) {
      const cur = stack.pop();
      indexes.push(cur);
      for (const neighbor of adjacency[cur]) {
        if (!visited[neighbor]) {
          visited[neighbor] = true;
          stack.push(neighbor);
        }
      }
    }
    components.push(indexes);
  }
  return components;
}

function componentSignature(componentPages) {
  const domainCounts = new Map();
  const semanticTokens = [];
  const topicTokens = [];
  const queryTokens = [];
  const intentTokens = [];
  let searchLikeCount = 0;
  for (const p of componentPages) {
    domainCounts.set(p.domain, (domainCounts.get(p.domain) || 0) + 1);
    semanticTokens.push(...p.semanticTokens);
    topicTokens.push(...p.topicTokens);
    queryTokens.push(...p.queryTokens);
    intentTokens.push(...intentTokensForPage(p));
    if (p.isSearchLike) searchLikeCount += 1;
  }
  const primaryDomain = [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const category = classifyTaskCategory(
    componentPages.map((p) => `${p.title} ${p.url}`).join(" ")
  );
  return { primaryDomain, category, semanticTokens, topicTokens, queryTokens, intentTokens, searchLikeCount };
}

function shouldMergeComponents(componentA, componentB, pages) {
  const pagesA = componentA.map((i) => pages[i]);
  const pagesB = componentB.map((i) => pages[i]);
  const sigA = componentSignature(pagesA);
  const sigB = componentSignature(pagesB);
  const sameDomain = sigA.primaryDomain === sigB.primaryDomain;
  const semanticOverlap = jaccard(sigA.semanticTokens, sigB.semanticTokens);
  const topicOverlap = jaccard(sigA.topicTokens, sigB.topicTokens);
  const sharedTopics = sharedTokenCount(sigA.topicTokens, sigB.topicTokens);
  const queryOverlap = jaccard(sigA.queryTokens, sigB.queryTokens);
  const sharedIntent = sharedTokenCount(sigA.intentTokens, sigB.intentTokens);
  const isSearchHeavy = sigA.searchLikeCount > 0 || sigB.searchLikeCount > 0;

  if (
    isSearchHeavy &&
    sharedIntent === 0 &&
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
    return true;
  }

  if (sigA.category === sigB.category && sigA.category !== "other") {
    return true;
  }

  if (
    sharedTopics >= 2 ||
    topicOverlap >= 0.18 ||
    semanticOverlap >= 0.2
  ) {
    return true;
  }

  return false;
}

function mergeComponentsHeuristically(components, pages) {
  if (components.length <= 1) return components;
  const parent = components.map((_, i) => i);
  const find = (x) => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
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
    if (ra !== rb) parent[rb] = ra;
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
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(...components[i]);
  }
  return [...grouped.values()].map((indexes) => [...new Set(indexes)]);
}

function inferTopic(componentPages) {
  const counts = new Map();
  for (const p of componentPages) {
    const domainParts = p.domain.split(".");
    const blocklist = new Set([...TOPIC_STOPWORDS, ...domainParts]);
    for (const t of [...p.queryTokens, ...p.semanticTokens]) {
      if (t.length < 3 || blocklist.has(t)) continue;
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3);
  if (!ranked.length) return "";
  const strong = ranked.filter(([, c]) => c >= 2).map(([t]) => t);
  if (strong.length >= 2) return `${strong[0]} ${strong[1]}`;
  if (strong.length === 1) return strong[0];
  if (ranked.length >= 2) return `${ranked[0][0]} ${ranked[1][0]}`;
  return ranked[0][0];
}

function titleizeTopic(topic) {
  const tokens = tokenize(topic).filter((t) => !TITLE_TOPIC_STOPWORDS.has(t)).slice(0, 3);
  if (!tokens.length) return "";
  return tokens.map((t) => t[0].toUpperCase() + t.slice(1)).join(" ");
}

function groupTitle(category, primaryDomain, topic) {
  const t = titleizeTopic(topic);
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
  switch (category) {
    case "ai": return t ? `AI: ${t}` : "AI Reading";
    case "dev": return t ? `Dev: ${t}` : "Dev";
    case "news": return t ? `News: ${t}` : "News";
    case "research": return t ? `Research: ${t}` : "Research";
    case "shopping": return t || `Shopping (${primaryDomain})`;
    case "travel": return t ? `Travel: ${t}` : "Travel";
    case "social": return t ? `Social: ${t}` : "Social";
    case "job": return t ? `Jobs: ${t}` : "Jobs";
    case "finance": return t ? `Finance: ${t}` : "Finance";
    case "food": return t ? `Food: ${t}` : "Food";
    case "entertainment": return t ? `Watch: ${t}` : "Entertainment";
    case "health": return t ? `Health: ${t}` : "Health";
    default: return t || cap(primaryDomain);
  }
}

export function clusterTabs(tabs) {
  const pages = (tabs || [])
    .filter((tab) => tab && tab.url && /^https?:/i.test(tab.url))
    .map(pageFromTab);

  if (pages.length < 2) return [];

  const components = buildComponents(pages, 0.34);
  const merged = mergeComponentsHeuristically(components, pages);

  const clusters = [];
  for (const indexes of merged) {
    if (indexes.length < 2) continue;
    const componentPages = indexes.map((i) => pages[i]);
    const sig = componentSignature(componentPages);
    const topic = inferTopic(componentPages);
    clusters.push({
      tabIds: componentPages.map((p) => p.tabId),
      title: groupTitle(sig.category, sig.primaryDomain, topic),
      category: sig.category,
      domain: sig.primaryDomain
    });
  }

  clusters.sort((a, b) => b.tabIds.length - a.tabIds.length);
  return clusters;
}
