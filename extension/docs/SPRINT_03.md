# Sprint 03 Plan (Open Loops + Nudges)

## Sprint goal
Detect unfinished high-interest tasks and nudge at controlled intervals without notification spam.

## In-scope tickets
- CR-017 Open-loop detector v1
- CR-018 Alarm scheduler and notification copy
- CR-019 Quiet hours and daily cap

## Current implementation status
- [x] CR-017 Open-loop detector v1
- [x] CR-018 Alarm scheduler and notification copy
- [x] CR-019 Quiet hours and daily cap

## Implemented behavior
- Hourly nudge-evaluation alarm checks active tasks for open-loop candidates.
- Open-loop candidate gate:
  - score >= 0.60
  - inactive between min hours and max days (configurable)
  - not done, not within per-task 24h cooldown
  - phase-specific suppression (`day1` ~= 24h, `day3` ~= 72h)
- Notification suppression:
  - quiet hours (start/end hour)
  - daily cap
  - 1 nudge per task per 24 hours
- Clicking a reminder opens briefing view and deep-links to the task card.

## Validation
- [x] Node syntax checks for worker/UI modules
- [x] Unit tests for nudge quiet-hours, scoring, and cap/cooldown behavior
- [ ] Manual browser verification of actual Chrome notifications

## Remaining risk
- Reminder copy and open-loop threshold need calibration from real usage.
- Notification delivery can vary by OS/browser notification settings.
