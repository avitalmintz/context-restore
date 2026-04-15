import test from "node:test";
import assert from "node:assert/strict";

import { buildTaskFeedFromEvents, canonicalizeUrl, safeDomain } from "../src/background/inference.js";

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
