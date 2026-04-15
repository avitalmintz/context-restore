# Sprint 02 Plan (Inference + Task Controls)

## Sprint goal
Upgrade from raw grouping to explainable task inference with user correction controls.

## In-scope tickets
- CR-005 Tracking pause and retention settings
- CR-006 URL canonicalization utility
- CR-007 Sessionization logic (heuristic v1)
- CR-009 Graph clustering v1
- CR-010 Page state classifier
- CR-011 Interest and completion scoring
- CR-015 Manual task rename
- CR-016 Mark done and suppression

## Current implementation status
- [x] CR-005 Tracking pause and retention settings
- [x] CR-006 URL canonicalization utility
- [x] CR-007 Sessionization logic (heuristic v1)
- [x] CR-009 Graph clustering v1
- [x] CR-010 Page state classifier
- [x] CR-011 Interest and completion scoring
- [x] CR-015 Manual task rename
- [x] CR-016 Mark done and suppression

## Validation
- [x] Node syntax checks for all JS modules
- [x] Unit tests for canonicalization, clustering output, and done override behavior
- [ ] Manual browser validation on real browsing traces

## Remaining risk before Sprint 3
- Clustering thresholds and label quality need calibration from real usage.
- Session boundaries are heuristic and may over/under-split long research sessions.
- Done/rename overrides depend on stable URL-based task IDs and may drift if browsing set changes heavily.
