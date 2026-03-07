# PicoLume Studio Cleanup Roadmap

Date: 2026-03-07

This roadmap turns the maintainability review into a concrete implementation plan. It is intentionally focused on structural cleanup, testability, and long-term maintenance. It does not add new user-facing features.

## Goals

- reduce coupling between frontend and backend
- improve integration test coverage at module boundaries
- make the frontend easier to reason about and change safely
- keep each refactor small enough to validate independently

## Working Rules

- keep behavior unchanged unless the task explicitly says otherwise
- prefer small PRs that each leave the app in a buildable, testable state
- add tests before or alongside each seam change
- avoid large rewrites of the rendering layer in one pass

## Phase 1: Replace String Contracts With Typed Responses

Priority: highest

### Why first

This is the best leverage point. It is relatively self-contained, reduces brittle cross-layer coupling, and creates a better base for integration tests.

### Scope

Replace backend methods that currently return plain strings with typed result payloads.

Primary targets:

- `app.go`
- `frontend/src/services/ProjectService.js`
- `frontend/src/core/Backend.js`
- any tests that assert exact string values for control flow

### Proposed shape

Use explicit response objects, for example:

```go
type SaveProjectResult struct {
    Status  string `json:"status"`
    Message string `json:"message"`
}
```

And on the frontend:

```js
if (result.status === 'ok') {
  // success path
}
```

Suggested statuses:

- `ok`
- `warning`
- `error`

### Concrete tasks

1. Add typed response structs for save, binary export, upload, and load operations in `app.go`.
2. Update Wails-exposed methods to return those structs instead of raw strings.
3. Adjust `Backend.js` to preserve structured responses without extra parsing.
4. Refactor `ProjectService.js` to branch on `status` and optional flags, not message text.
5. Keep human-readable messages as display text only.
6. Add tests for both success and failure payload shapes.

### Done criteria

- no frontend control flow depends on `"Saved"`, `"OK"`, or `"Success"` string matching
- backend methods return structured objects consistently
- the same user-facing messages still appear in the UI where expected

### Test targets

- Go tests for `SaveProjectToPath`, `SaveBinaryData`, `UploadToPico`, and `LoadProject`
- frontend tests for `ProjectService` success, warning, and failure branches
- one contract-level test for `Backend` result normalization

## Phase 2: Reduce Global Event Coupling In The Frontend

Priority: high

### Why second

The global `window` event bus and oversized bootstrap flow are the main maintainability problem. After Phase 1, the next highest return is reducing the amount of hidden cross-module coordination.

### Scope

Break up `main.js` and reduce direct `window.dispatchEvent` usage for app-internal state changes.

Primary targets:

- `frontend/src/main.js`
- `frontend/src/controllers/TimelineController.js`
- `frontend/src/timeline.js`
- `frontend/src/core/Application.js`

### Concrete tasks

1. Identify event categories currently flowing through `window`:
   - timeline change
   - selection change
   - time change
   - zoom change
   - grid change
2. Introduce a small injected event hub or app-level coordinator object.
3. Move `main.js` setup into focused modules:
   - app bootstrap
   - layout/shell wiring
   - timeline wiring
   - project actions
   - status bar wiring
4. Change `TimelineController` to call collaborators through injected dependencies where possible.
5. Remove the mutable singleton `deps` pattern from `timeline.js`.

### Done criteria

- `main.js` is materially smaller and mostly composition-oriented
- app-internal coordination no longer depends primarily on `window.dispatchEvent`
- timeline-related behavior can be tested without setting up a global browser event bus

### Test targets

- unit tests for the new event hub or coordinator
- `TimelineController` tests that assert collaborator calls rather than global events
- smoke-level integration test for app bootstrap wiring

## Phase 3: Split `InspectorRenderer` By Responsibility

Priority: high

### Why third

The inspector is a large maintenance hotspot, but it should be split after the communication seams are cleaner so the work does not compound two kinds of refactor risk at once.

### Scope

Break `InspectorRenderer` into smaller focused renderers or section presenters while preserving current UI behavior.

Primary target:

- `frontend/src/views/InspectorRenderer.js`

Suggested sections:

- project settings
- cue properties
- clip properties
- hardware profile settings
- palette/editor sections

### Concrete tasks

1. Extract one section at a time behind the existing top-level renderer.
2. Keep `InspectorRenderer` as a thin dispatcher that selects the active section.
3. Move section-specific DOM creation and event binding into dedicated modules.
4. Centralize shared helpers for labels, numeric inputs, validation, and row rendering.
5. Keep local storage collapse-state handling in one shared utility rather than duplicating it.

### Done criteria

- no single inspector file owns all section rendering behavior
- adding a new inspector section no longer requires editing a 2000+ line file
- section-level behavior can be tested directly

### Test targets

- direct tests for project settings editing
- direct tests for cue property editing
- direct tests for clip property editing
- keep existing XSS tests intact

## Phase 4: Fill The Integration-Test Gaps

Priority: medium-high

### Why here

By this point, the main contracts and orchestration seams should be cleaner. That is the right moment to lock them down with tests.

### Scope

Expand tests beyond utilities and leaf modules.

Primary targets:

- `app.go`
- `frontend/src/services/ProjectService.js`
- `frontend/src/core/Backend.js`
- `frontend/src/core/Application.js`
- `bingen/`
- `logger/`

### Concrete tasks

1. Add Go tests that cover Wails-facing save/load/upload behavior with realistic success and error cases.
2. Add `ProjectService` tests that verify user-visible flows from backend result to UI-facing state.
3. Add `Backend` tests for transport and shape normalization.
4. Add at least one `Application`-level test for startup and service wiring.
5. Add coverage for `bingen` output shaping and error handling.
6. Add light tests for `logger` if it contains branching behavior worth protecting.

### Done criteria

- integration seams have explicit automated coverage
- package coverage improves meaningfully from the current baseline
- regressions in save/load/upload wiring are caught by tests, not manual QA

### Test targets

- raise Go coverage materially above the current `35.3%`
- eliminate `0.0%` coverage in `bingen`
- ensure orchestration modules have at least basic direct coverage

## Phase 5: Fix Coverage Tooling And Baseline Reporting

Priority: medium

### Why now

Coverage should not drive design, but once the key seams are tested it should be easy to measure and track.

### Scope

Repair frontend coverage execution and document the standard verification commands.

Primary targets:

- `frontend/package.json`
- frontend dev dependencies
- project documentation if needed

### Concrete tasks

1. Install and configure the missing Vitest coverage provider.
2. Verify `npm test -- --run --coverage` works locally.
3. Decide whether to use V8 or Istanbul coverage and keep the config explicit.
4. Document the expected Go and frontend test commands.

### Done criteria

- frontend coverage runs without extra local setup
- the repo has one clear set of verification commands

## Phase 6: Revisit `StateManager` Only If Needed

Priority: later

### Why last

`StateManager` may become a performance issue, but it is not the current bottleneck in maintainability. It should only be changed after the higher-value cleanup is complete and only if profiling or usage shows real pressure.

### Scope

Evaluate whether deep clone and deep freeze behavior needs adjustment.

Primary target:

- `frontend/src/core/StateManager.js`

### Concrete tasks

1. Measure whether large projects or frequent inspector edits create noticeable overhead.
2. If needed, separate highly mutable UI state from frozen project state.
3. Consider narrower immutability boundaries instead of whole-tree freezing.

### Done criteria

- any change is driven by evidence, not speculation
- state behavior remains predictable and testable

## Recommended Execution Order

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6 only if evidence justifies it

## Suggested PR Breakdown

1. Typed backend responses plus `ProjectService` contract tests
2. `main.js` bootstrap split plus event hub introduction
3. `TimelineController` and `timeline.js` decoupling
4. `InspectorRenderer` extraction pass 1
5. `InspectorRenderer` extraction pass 2 plus section tests
6. Go integration tests for save/load/upload and `bingen`
7. Frontend coverage tooling fix

## Validation Checklist

- `go test ./...`
- `go test -cover ./...`
- `npm test -- --run`
- `npm test -- --run --coverage`
- manual smoke test for project open/save/export/upload flows

## Bottom Line

If you want the codebase to be easier to maintain without changing the product, the first move should be Phase 1. It is the smallest high-value refactor and it sets up the rest of the cleanup work cleanly.
