const DB_NAME = "context_restore_db";
const DB_VERSION = 1;
const EVENTS_STORE = "events";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        const store = db.createObjectStore(EVENTS_STORE, { keyPath: "event_id" });
        store.createIndex("by_ts", "ts", { unique: false });
        store.createIndex("by_type", "event_type", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
  });
}

function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function addEvent(event) {
  const db = await openDb();
  const tx = db.transaction(EVENTS_STORE, "readwrite");
  tx.objectStore(EVENTS_STORE).put(event);
  await txComplete(tx);
  db.close();
}

export async function getRecentEvents(limit = 500, sinceTs = 0) {
  const db = await openDb();
  const tx = db.transaction(EVENTS_STORE, "readonly");
  const index = tx.objectStore(EVENTS_STORE).index("by_ts");
  const events = await new Promise((resolve, reject) => {
    const request = index.getAll(IDBKeyRange.lowerBound(sinceTs));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });

  await txComplete(tx);
  db.close();
  events.sort((a, b) => b.ts - a.ts);
  return events.slice(0, limit);
}

export async function pruneEventsBefore(cutoffTs) {
  const db = await openDb();
  const tx = db.transaction(EVENTS_STORE, "readwrite");
  const store = tx.objectStore(EVENTS_STORE);
  const index = store.index("by_ts");
  const keysToDelete = await new Promise((resolve, reject) => {
    const request = index.getAllKeys(IDBKeyRange.upperBound(cutoffTs - 1));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
  for (const key of keysToDelete) {
    store.delete(key);
  }

  await txComplete(tx);
  db.close();
}

export async function clearAllEvents() {
  const db = await openDb();
  const tx = db.transaction(EVENTS_STORE, "readwrite");
  tx.objectStore(EVENTS_STORE).clear();
  await txComplete(tx);
  db.close();
}

export async function deleteEventsByUrls(urls) {
  const normalized = [...new Set((urls || []).filter(Boolean))];
  if (!normalized.length) {
    return 0;
  }

  const urlSet = new Set(normalized);
  const db = await openDb();
  const tx = db.transaction(EVENTS_STORE, "readwrite");
  const store = tx.objectStore(EVENTS_STORE);

  const allEvents = await new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });

  let deleted = 0;
  for (const event of allEvents) {
    if (urlSet.has(event.url)) {
      store.delete(event.event_id);
      deleted += 1;
    }
  }

  await txComplete(tx);
  db.close();
  return deleted;
}
