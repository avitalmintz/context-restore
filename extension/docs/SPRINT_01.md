# Sprint 01 Plan (Instrumentation + Basic Briefing)

## Sprint goal
Ship a working prototype loop:
1. Collect browsing + engagement signals.
2. Infer basic task groupings.
3. Show task briefings in popup/full page.
4. Resume a task from briefing.

## In-scope tickets
- CR-001 MV3 scaffold and permissions
- CR-002 Tab and navigation ingestion
- CR-003 Content engagement snapshots
- CR-004 IndexedDB event store
- CR-008 Domain-seeded task feed (interim)
- CR-012 Popup quick-view UI
- CR-013 Full briefing page
- CR-014 Resume action flow
- CR-020 Delete-all local data

## Current implementation status
- [x] CR-001 MV3 scaffold and permissions
- [x] CR-002 Tab and navigation ingestion
- [x] CR-003 Content engagement snapshots
- [x] CR-004 IndexedDB event store
- [x] CR-008 Domain-seeded task feed (interim)
- [x] CR-012 Popup quick-view UI
- [x] CR-013 Full briefing page
- [x] CR-014 Resume action flow
- [x] CR-020 Delete-all local data
- [ ] Manual browser test checklist

## Definition of done
- Extension loads with no startup errors.
- Events are visible in IndexedDB and grow during browsing.
- Popup shows task cards from real captured data.
- Briefing page renders full task list and supports refresh.
- Resume action opens tabs from selected task.
- Settings page can pause tracking and clear all stored data.

## Manual test checklist
- [ ] Install extension as unpacked and confirm worker starts.
- [ ] Browse 8 to 12 pages across at least 2 intents (shopping + news).
- [ ] Verify task feed shows at least 2 separate groups.
- [ ] Click Resume on a task and confirm tabs open in expected order.
- [ ] Pause tracking and verify no new events are ingested.
- [ ] Click delete data and verify task feed empties.

## Execution notes
- This sprint intentionally uses a domain-seeded grouping heuristic.
- Graph clustering and richer scoring move to Sprint 2.
