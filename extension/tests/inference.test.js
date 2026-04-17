import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDailySemanticsFromEvents,
  buildTaskFeedFromEvents,
  canonicalizeUrl,
  safeDomain
} from "../src/background/inference.js";

function ev({
  event_type,
  ts,
  url,
  title = "",
  payload = {},
  tab_id = 1,
  window_id = 1
}) {
  return {
    event_id: `${event_type}-${ts}-${Math.random().toString(36).slice(2, 6)}`,
    event_type,
    ts,
    tab_id,
    window_id,
    url,
    domain: safeDomain(url),
    title,
    payload
  };
}

test("canonicalizeUrl strips tracking params and hash", () => {
  const input = "https://example.com/jacket?utm_source=x&color=blue&fbclid=abc#reviews";
  const output = canonicalizeUrl(input);
  assert.equal(output, "https://example.com/jacket");
});

test("canonicalizeUrl keeps search query params but drops non-search state params", () => {
  const searchInput =
    "https://www.google.com/search?q=best+jacket&sourceid=chrome&ie=UTF-8&utm_source=x";
  const searchOutput = canonicalizeUrl(searchInput);
  assert.equal(searchOutput, "https://google.com/search?q=best+jacket");

  const statefulInput =
    "https://studiothree.com/schedule?_mt=%2Fschedule%2Fdaily%2F48541%3FactiveDate%3D2026-04-14%26locations%3D48719";
  const statefulOutput = canonicalizeUrl(statefulInput);
  assert.equal(statefulOutput, "https://studiothree.com/schedule");
});

test("buildTaskFeedFromEvents infers shopping task and scores page states", () => {
  const start = 1_700_000_000_000;
  const events = [
    ev({ event_type: "tab_activated", ts: start + 1_000, url: "https://reformation.com/products/jacket-a", title: "Jacket A" }),
    ev({ event_type: "engagement_snapshot", ts: start + 6_000, url: "https://reformation.com/products/jacket-a", payload: { activeMsSinceLast: 45_000, scrollPct: 82 } }),
    ev({ event_type: "engagement_snapshot", ts: start + 12_000, url: "https://reformation.com/products/jacket-a", payload: { activeMsSinceLast: 40_000, scrollPct: 90 } }),
    ev({ event_type: "tab_activated", ts: start + 15_000, url: "https://gap.com/product/jacket-b", title: "Jacket B" }),
    ev({ event_type: "engagement_snapshot", ts: start + 18_000, url: "https://gap.com/product/jacket-b", payload: { activeMsSinceLast: 18_000, scrollPct: 28 } }),
    ev({ event_type: "tab_activated", ts: start + 22_000, url: "https://ae.com/us/en/p/women/jackets/jacket-c", title: "Jacket C" }),
    ev({ event_type: "engagement_snapshot", ts: start + 24_000, url: "https://ae.com/us/en/p/women/jackets/jacket-c", payload: { activeMsSinceLast: 12_000, scrollPct: 12 } })
  ];

  const tasks = buildTaskFeedFromEvents(events, { limit: 10 });
  assert.ok(tasks.length >= 1);

  const shoppingTask = tasks.find((task) => task.category === "shopping");
  assert.ok(shoppingTask, "expected at least one shopping task");
  assert.ok(shoppingTask.stats.pageCount >= 1);
  assert.ok(shoppingTask.pages.some((page) => ["read", "skimmed", "bounced"].includes(page.state)));
});

test("done override suppresses task by default and includeDone shows it", () => {
  const ts = 1_700_000_100_000;
  const events = [
    ev({ event_type: "tab_activated", ts: ts + 1_000, url: "https://news.ycombinator.com/item?id=1", title: "News" }),
    ev({ event_type: "engagement_snapshot", ts: ts + 3_000, url: "https://news.ycombinator.com/item?id=1", payload: { activeMsSinceLast: 25_000, scrollPct: 50 } })
  ];

  const tasks = buildTaskFeedFromEvents(events, { limit: 10, includeDone: true });
  assert.equal(tasks.length, 1);

  const taskId = tasks[0].taskId;
  const hidden = buildTaskFeedFromEvents(events, {
    limit: 10,
    taskOverrides: {
      [taskId]: { done: true }
    }
  });
  assert.equal(hidden.length, 0);

  const visibleDone = buildTaskFeedFromEvents(events, {
    limit: 10,
    includeDone: true,
    taskOverrides: {
      [taskId]: { done: true, title: "Done task" }
    }
  });
  assert.equal(visibleDone.length, 1);
  assert.equal(visibleDone[0].status, "done");
  assert.equal(visibleDone[0].title, "Done task");
});

test("snoozed override hides task by default and appears with includeDone", () => {
  const ts = 1_700_000_200_000;
  const nowTs = ts + 10_000;
  const events = [
    ev({
      event_type: "tab_activated",
      ts: ts + 1_000,
      url: "https://google.com/search?q=soccer+ball",
      title: "soccer ball - Google Search"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 4_000,
      url: "https://google.com/search?q=soccer+ball",
      payload: { activeMsSinceLast: 20_000, scrollPct: 36 }
    })
  ];

  const tasks = buildTaskFeedFromEvents(events, { limit: 10, includeDone: true, nowTs });
  assert.equal(tasks.length, 1);
  const taskId = tasks[0].taskId;

  const hidden = buildTaskFeedFromEvents(events, {
    limit: 10,
    nowTs,
    taskOverrides: {
      [taskId]: { status: "snoozed", snoozedUntilTs: nowTs + 24 * 60 * 60 * 1000 }
    }
  });
  assert.equal(hidden.length, 0);

  const include = buildTaskFeedFromEvents(events, {
    limit: 10,
    includeDone: true,
    nowTs,
    taskOverrides: {
      [taskId]: { status: "snoozed", snoozedUntilTs: nowTs + 24 * 60 * 60 * 1000 }
    }
  });
  assert.equal(include.length, 1);
  assert.equal(include[0].status, "snoozed");
});

test("task includes decision context, timeline, and resume plan", () => {
  const ts = 1_700_010_000_000;
  const events = [
    ev({
      event_type: "tab_activated",
      ts: ts + 1_000,
      url: "https://google.com/search?q=adidas+soccer+ball",
      title: "adidas soccer ball - Google Search"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 4_000,
      url: "https://google.com/search?q=adidas+soccer+ball",
      payload: { activeMsSinceLast: 12_000, scrollPct: 20 }
    }),
    ev({
      event_type: "tab_activated",
      ts: ts + 7_000,
      url: "https://www.adidas.com/us/soccer-balls",
      title: "Adidas Soccer Balls"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 10_000,
      url: "https://www.adidas.com/us/soccer-balls",
      payload: { activeMsSinceLast: 45_000, scrollPct: 86 }
    }),
    ev({
      event_type: "tab_activated",
      ts: ts + 14_000,
      url: "https://www.amazon.com/s?k=soccer+ball",
      title: "Amazon soccer ball"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 17_000,
      url: "https://www.amazon.com/s?k=soccer+ball",
      payload: { activeMsSinceLast: 16_000, scrollPct: 25 }
    }),
    ev({
      event_type: "tab_activated",
      ts: ts + 22_000,
      url: "https://www.adidas.com/us/soccer-balls",
      title: "Adidas Soccer Balls"
    })
  ];

  const tasks = buildTaskFeedFromEvents(events, { limit: 10, includeDone: true, nowTs: ts + 30_000 });
  assert.ok(tasks.length >= 1);
  const target = tasks[0];
  assert.ok(Array.isArray(target.timeline));
  assert.ok(target.timeline.length >= 1);
  assert.ok(Array.isArray(target.resumePlan?.orderedUrls));
  assert.ok(target.resumePlan.orderedUrls.length >= 1);
  assert.ok(Array.isArray(target.decisionContext?.reasons));
  assert.ok(target.decisionContext.reasons.length >= 1);
});

test("task titles avoid generic task around wording", () => {
  const ts = 1_700_010_100_000;
  const events = [
    ev({
      event_type: "tab_activated",
      ts: ts + 1_000,
      url: "https://google.com/search?q=neuralese",
      title: "neuralese - Google Search"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 4_000,
      url: "https://google.com/search?q=neuralese",
      payload: { activeMsSinceLast: 25_000, scrollPct: 45 }
    })
  ];

  const tasks = buildTaskFeedFromEvents(events, { limit: 10, includeDone: true });
  assert.equal(tasks.length, 1);
  assert.ok(!/task around/i.test(tasks[0].title));
});

test("keeps shopping cluster separate from unrelated tech/news article", () => {
  const ts = 1_700_010_500_000;
  const events = [
    ev({
      event_type: "tab_activated",
      ts: ts + 1_000,
      url: "https://google.com/search?q=jackets",
      title: "jackets - Google Search"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 5_000,
      url: "https://google.com/search?q=jackets",
      payload: { activeMsSinceLast: 20_000, scrollPct: 30 }
    }),
    ev({
      event_type: "tab_activated",
      ts: ts + 11_000,
      url: "https://www.reformation.com/products/napoleon-faux-leather-jacket-black",
      title: "Napoleon Faux Leather Jacket Black | Reformation"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 16_000,
      url: "https://www.reformation.com/products/napoleon-faux-leather-jacket-black",
      payload: { activeMsSinceLast: 38_000, scrollPct: 82 }
    }),
    ev({
      event_type: "tab_activated",
      ts: ts + 22_000,
      url: "https://wallpaper.com/tech/these-kickstarter-catastrophes-and-design-duds-proved-tech-wasnt-always-the-answer-in-2025",
      title: "These Kickstarter catastrophes and design duds proved tech wasn’t always the answer in 2025 | Wallpaper*"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 27_000,
      url: "https://wallpaper.com/tech/these-kickstarter-catastrophes-and-design-duds-proved-tech-wasnt-always-the-answer-in-2025",
      payload: { activeMsSinceLast: 24_000, scrollPct: 44 }
    })
  ];

  const tasks = buildTaskFeedFromEvents(events, { limit: 10, includeDone: true });
  const shopping = tasks.find(
    (task) =>
      task.category === "shopping" &&
      task.urls.some((url) => url.includes("google.com/search?q=jackets")) &&
      task.urls.some((url) => url.includes("reformation.com/products"))
  );
  assert.ok(shopping, "expected jackets search + reformation page in same shopping task");
  assert.ok(
    !shopping.urls.some((url) => url.includes("wallpaper.com/tech")),
    "wallpaper article should not be merged into shopping cluster"
  );
});

test("shopping adapter exposes option list and coverage checks", () => {
  const ts = 1_700_010_700_000;
  const events = [
    ev({
      event_type: "tab_activated",
      ts: ts + 1_000,
      url: "https://google.com/search?q=adidas+soccer+ball",
      title: "adidas soccer ball - Google Search"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 4_000,
      url: "https://google.com/search?q=adidas+soccer+ball",
      payload: { activeMsSinceLast: 18_000, scrollPct: 24 }
    }),
    ev({
      event_type: "tab_activated",
      ts: ts + 8_000,
      url: "https://www.adidas.com/us/soccer-balls",
      title: "Adidas Soccer Balls"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 12_000,
      url: "https://www.adidas.com/us/soccer-balls",
      payload: { activeMsSinceLast: 42_000, scrollPct: 88 }
    }),
    ev({
      event_type: "tab_activated",
      ts: ts + 15_000,
      url: "https://www.amazon.com/s?k=soccer+ball+reviews",
      title: "Amazon soccer ball reviews"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 20_000,
      url: "https://www.amazon.com/s?k=soccer+ball+reviews",
      payload: { activeMsSinceLast: 20_000, scrollPct: 35 }
    })
  ];

  const tasks = buildTaskFeedFromEvents(events, { limit: 10, includeDone: true });
  const shopping = tasks.find((task) => task.category === "shopping");
  assert.ok(shopping);
  assert.equal(shopping.adapter?.type, "shopping");
  assert.ok(Array.isArray(shopping.adapter?.options));
  assert.ok(shopping.adapter.options.length >= 1);
  assert.equal(typeof shopping.adapter?.checks?.reviews, "boolean");
  assert.equal(typeof shopping.adapter?.checks?.returnPolicy, "boolean");
  assert.equal(typeof shopping.adapter?.checks?.price, "boolean");
});

test("buildDailySemanticsFromEvents returns semantic recap and time sinks", () => {
  const ts = 1_700_020_000_000;
  const events = [
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 1_000,
      url: "https://www.adidas.com/us/soccer-balls",
      title: "Adidas Soccer Balls",
      payload: { activeMsSinceLast: 30 * 60 * 1000, scrollPct: 80 }
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 2_000,
      url: "https://instagram.com/",
      title: "Instagram",
      payload: { activeMsSinceLast: 35 * 60 * 1000, scrollPct: 20 }
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 3_000,
      url: "https://google.com/search?q=soccer+ball+reviews",
      title: "soccer ball reviews - Google Search",
      payload: { activeMsSinceLast: 10 * 60 * 1000, scrollPct: 25 }
    }),
    ev({
      event_type: "tab_activated",
      ts: ts + 4_000,
      url: "https://google.com/search?q=soccer+ball+reviews",
      title: "soccer ball reviews - Google Search"
    }),
    ev({
      event_type: "tab_activated",
      ts: ts + 5_000,
      url: "https://google.com/search?q=soccer+ball+reviews",
      title: "soccer ball reviews - Google Search"
    })
  ];

  const summaries = buildDailySemanticsFromEvents(events, {
    days: 7,
    nowTs: ts + 6_000
  });
  assert.equal(summaries.length, 1);
  const day = summaries[0];
  assert.ok(day.semanticSummary.includes("You spent"));
  assert.ok(Array.isArray(day.topCategories));
  assert.ok(day.topCategories.length >= 1);
  assert.ok(Array.isArray(day.likelyTimeSinks));
  assert.ok(typeof day.coaching === "string");
});

test("does not merge unrelated same-domain shopping topics by default", () => {
  const ts = 1_700_001_000_000;
  const events = [
    ev({
      event_type: "tab_activated",
      ts: ts + 1_000,
      url: "https://www.amazon.com/s?k=soccer+ball",
      title: "Amazon soccer ball"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 6_000,
      url: "https://www.amazon.com/s?k=soccer+ball",
      payload: { activeMsSinceLast: 25_000, scrollPct: 40 }
    }),
    ev({
      event_type: "tab_activated",
      ts: ts + 10 * 60 * 1000,
      url: "https://www.amazon.com/s?k=womens+jacket",
      title: "Amazon womens jacket"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 10 * 60 * 1000 + 5_000,
      url: "https://www.amazon.com/s?k=womens+jacket",
      payload: { activeMsSinceLast: 30_000, scrollPct: 55 }
    })
  ];

  const tasks = buildTaskFeedFromEvents(events, { limit: 10, includeDone: true });
  assert.ok(tasks.length >= 2);
});

test("merges cross-domain shopping pages when product intent overlaps", () => {
  const ts = 1_700_001_500_000;
  const events = [
    ev({
      event_type: "tab_activated",
      ts: ts + 1_000,
      url: "https://google.com/search?q=jackets",
      title: "jackets - Google Search"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 5_000,
      url: "https://google.com/search?q=jackets",
      payload: { activeMsSinceLast: 18_000, scrollPct: 32 }
    }),
    ev({
      event_type: "tab_activated",
      ts: ts + 20_000,
      url: "https://www.bloomingdales.com/shop/product/barbour-arlene-waxed-jacket?ID=5661796",
      title: "Barbour Arlene Waxed Jacket | Bloomingdale's Women"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 25_000,
      url: "https://www.bloomingdales.com/shop/product/barbour-arlene-waxed-jacket?ID=5661796",
      payload: { activeMsSinceLast: 17_000, scrollPct: 24 }
    }),
    ev({
      event_type: "tab_activated",
      ts: ts + 40_000,
      url: "https://www.renttherunway.com/shop/designers/polo_ralph_lauren/cotton_canvas_jacket",
      title: "Cotton Canvas Jacket by Polo Ralph Lauren | Rent the Runway"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 45_000,
      url: "https://www.renttherunway.com/shop/designers/polo_ralph_lauren/cotton_canvas_jacket",
      payload: { activeMsSinceLast: 16_000, scrollPct: 28 }
    })
  ];

  const tasks = buildTaskFeedFromEvents(events, { limit: 10, includeDone: true });
  const shoppingTask = tasks.find(
    (task) => task.category === "shopping" && task.stats.pageCount >= 2
  );
  assert.ok(shoppingTask, "expected shopping pages to cluster together");
});

test("does not merge shopping search with unrelated research article", () => {
  const ts = 1_700_001_900_000;
  const events = [
    ev({
      event_type: "tab_activated",
      ts: ts + 1_000,
      url: "https://wallpaper.com/tech/these-kickstarter-catastrophes-and-design-duds-proved-tech-wasnt-always-the-answer-in-2025",
      title: "These Kickstarter catastrophes and design duds proved tech wasn’t always the answer in 2025 | Wallpaper*"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 8_000,
      url: "https://wallpaper.com/tech/these-kickstarter-catastrophes-and-design-duds-proved-tech-wasnt-always-the-answer-in-2025",
      payload: { activeMsSinceLast: 22_000, scrollPct: 46 }
    }),
    ev({
      event_type: "tab_activated",
      ts: ts + 16_000,
      url: "https://google.com/search?q=jackets",
      title: "jackets - Google Search"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 21_000,
      url: "https://google.com/search?q=jackets",
      payload: { activeMsSinceLast: 17_000, scrollPct: 31 }
    })
  ];

  const tasks = buildTaskFeedFromEvents(events, { limit: 10, includeDone: true });
  assert.ok(tasks.length >= 2, "expected separate tasks for research vs shopping");
});

test("splits low-signal outlier page from research cluster", () => {
  const ts = 1_700_002_000_000;
  const events = [
    ev({
      event_type: "tab_activated",
      ts: ts + 1_000,
      url: "https://nlp.cs.berkeley.edu/pubs/Andreas-Dragan-Klein_2017_Neuralese_paper.pdf",
      title: "Neuralese paper"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 8_000,
      url: "https://nlp.cs.berkeley.edu/pubs/Andreas-Dragan-Klein_2017_Neuralese_paper.pdf",
      payload: { activeMsSinceLast: 40_000, scrollPct: 78 }
    }),
    ev({
      event_type: "tab_activated",
      ts: ts + 15_000,
      url: "https://medium.com/@diegodotta/neuralese-the-most-spoken-language-youll-never-speak-a42522f68ff3",
      title: "Neuralese medium article"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 22_000,
      url: "https://medium.com/@diegodotta/neuralese-the-most-spoken-language-youll-never-speak-a42522f68ff3",
      payload: { activeMsSinceLast: 28_000, scrollPct: 62 }
    }),
    ev({
      event_type: "tab_activated",
      ts: ts + 28_000,
      url: "https://thereformation.com/?fbvar=brandedgoogle&gad_source=1",
      title: "Reformation"
    }),
    ev({
      event_type: "engagement_snapshot",
      ts: ts + 30_000,
      url: "https://thereformation.com/?fbvar=brandedgoogle&gad_source=1",
      payload: { activeMsSinceLast: 3_000, scrollPct: 3 }
    })
  ];

  const tasks = buildTaskFeedFromEvents(events, { limit: 10, includeDone: true });
  const largeTasks = tasks.filter((task) => task.stats.pageCount >= 2);
  assert.ok(largeTasks.length >= 1);
  assert.ok(largeTasks.some((task) => task.urls.some((url) => url.includes("neuralese"))));
  assert.ok(!largeTasks.some((task) => task.urls.some((url) => url.includes("thereformation.com"))));
});
