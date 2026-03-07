# PicoLume Studio Maintainability Review

Date: 2026-03-07

## Scope

This review focused on:

- overall code structure and layering
- testability and current test coverage
- maintainability risks
- current build and test health

It does not propose new user-facing features.

## Executive Summary

Studio has a solid foundation, especially on the backend and in several frontend core modules:

- the Go backend uses interface-based seams for hardware access in `device.go`
- the frontend has meaningful unit coverage for `StateManager`, `TimelineController`, `AudioService`, safety utilities, and XSS/zip parsing cases
- security-conscious file handling is present on both frontend and backend
- architectural intent is documented clearly in the `docs/` material

The main weaknesses are structural rather than functional:

1. several key frontend modules are still very large and act as orchestration hubs
2. cross-layer contracts rely on magic strings in a few important places
3. test coverage drops off at the orchestration/integration boundary
4. the advertised frontend coverage command is currently broken

My overall assessment is:

- product risk: moderate
- maintainability risk: moderate-to-high
- testability: good at the unit level, weaker at integration seams
- readiness for future changes: acceptable, but the frontend orchestration layer should be simplified before the codebase grows much further

## Current Verification

I ran the current test suites:

- `go test ./...` -> pass
- `go test -cover ./...` -> `PicoLume` 35.3% statement coverage; `bingen` 0.0%; `logger` 0.0%
- `npm test -- --run` -> pass, 10 files / 242 tests
- `npm test -- --run --coverage` -> fails because `@vitest/coverage-v8` is missing

## Strengths

### 1. Backend hardware access is designed for testing

`device.go` defines `PortEnumerator`, `PortOpener`, `SerialPort`, and `DriveScanner`, which makes the serial/USB workflow unit-testable without real hardware. This is one of the cleanest parts of the codebase.

Relevant files:

- `device.go`
- `device_test.go`

### 2. The frontend has real unit-test value, not just smoke tests

The frontend tests cover useful logic:

- state mutation and observers
- timeline controller behavior
- audio retry/timeout helpers
- zip safety limits
- XSS-safe rendering behavior
- show.bin parsing

That is a healthy baseline and much better than a UI codebase with only snapshot tests or no tests at all.

Relevant files:

- `frontend/src/__tests__/StateManager.test.js`
- `frontend/src/__tests__/TimelineController.test.js`
- `frontend/src/__tests__/AudioService.test.js`
- `frontend/src/__tests__/ZipUtilSafety.test.js`
- `frontend/src/__tests__/XssSafety.test.js`

### 3. Security and input validation have been taken seriously

Examples:

- absolute-path and extension validation in `project.go`
- zip size and extracted-size limits in `app.go`
- zip safety tests on the frontend
- XSS tests for renderer output

That lowers the chance of accidental regressions in areas that tend to get ignored in internal tooling apps.

## Findings

### 1. High: the frontend/backend contract is still stringly typed

The backend returns plain strings for save/export/upload outcomes, and the frontend branches on exact string values.

Evidence:

- `app.go:95` `SaveProjectToPath(...) string`
- `app.go:168` returns `"Saved"`
- `app.go:173` `SaveBinaryData(...) string`
- `app.go:196` returns `"OK"`
- `app.go:200` `UploadToPico(...) string`
- `app.go:249` returns a formatted success string
- `frontend/src/services/ProjectService.js:63` checks `result === "Saved"`
- `frontend/src/services/ProjectService.js:210` checks `result === "OK"`
- `frontend/src/services/ProjectService.js:250` checks `result.startsWith("Success")`

Why this matters:

- it couples two layers through wording instead of structure
- it makes refactors and localization risky
- it weakens tests because behavior is tied to message text
- it encourages ad-hoc parsing of outcomes rather than explicit state

Recommendation:

- replace string returns with typed result payloads for save/export/upload
- keep user-facing message text as a field on the response, not the contract itself

### 2. High: the frontend orchestration layer is still too centralized

The intended architecture exists, but a large amount of coordination still lives in giant modules with global state and global browser events. The main pressure point is `main.js` plus the `window` event bus pattern; `timeline.js` is smaller, but it still participates in that same global-coordination style.

Evidence:

- `frontend/src/main.js:27` explicitly says "Global references for legacy code compatibility"
- `frontend/src/main.js:33` starts a very large `DOMContentLoaded` bootstrap
- `frontend/src/main.js:901`+ registers multiple app-wide listeners in the same file
- `frontend/src/timeline.js:6` keeps module-level mutable `deps`
- `frontend/src/timeline.js:112` attaches global listeners centrally
- `frontend/src/controllers/TimelineController.js:40`, `:56`, `:91`, `:113`, `:132`, `:151`, `:213`, `:250`, `:261`, `:396`, `:424`, `:440`, `:454`, `:476` dispatch `window` events directly

Current size symptoms as of 2026-03-07:

- `frontend/src/main.js` -> 1858 lines
- `frontend/src/views/InspectorRenderer.js` -> 2181 lines
- `frontend/src/core/StateManager.js` -> 681 lines

Why this matters:

- the code is harder to reason about because control flow is spread across DOM listeners and `window` custom events
- test isolation is weaker because modules depend on singleton mutable state and browser globals
- onboarding cost rises because "where does this behavior actually happen?" is no longer obvious

Recommendation:

- split `main.js` by concern: shell/windowing, layout, timeline input, project actions, status bar
- replace the `window` event bus with a small injected event hub or controller/service calls
- remove the singleton `deps` pattern from `timeline.js`

### 3. Medium: `InspectorRenderer` is carrying too many responsibilities in one class

`InspectorRenderer` handles:

- global project settings
- cue editing
- multi-selection state
- clip editing
- hardware profiles
- palette management
- localStorage-backed UI collapse state
- substantial DOM creation and event wiring

Evidence:

- `frontend/src/views/InspectorRenderer.js:33` class start
- `frontend/src/views/InspectorRenderer.js:219` main `render()`
- `frontend/src/views/InspectorRenderer.js:292` project settings rendering
- `frontend/src/views/InspectorRenderer.js:474` cue rendering
- `frontend/src/views/InspectorRenderer.js:1786` clip property rendering

Why this matters:

- any change to inspector behavior has a high chance of touching unrelated logic
- the class is expensive to understand and review
- direct DOM construction plus business rules in one file reduces reuse and targeted testing

Recommendation:

- split the inspector into section renderers or section presenters
- keep the top-level renderer responsible only for choosing which section to show
- add direct behavior tests for inspector editing flows, not just XSS protection

### 4. Medium: test quality is good, but integration coverage is noticeably thinner than unit coverage

The strongest tests are at the utility/controller level. The orchestration layers are much less covered.

Observed gaps:

- no direct frontend tests for `Application`
- no direct frontend tests for `ProjectService`
- no direct frontend tests for `Backend`
- no direct functional tests for `InspectorRenderer` behavior beyond the XSS checks
- backend packages `bingen` and `logger` have no tests
- `app_test.go` focuses on binary generation helpers rather than the Wails-facing save/load/upload methods in `app.go`

Evidence:

- only three Go test files exist: `app_test.go`, `device_test.go`, `project_test.go`
- frontend tests exist for core modules, but not for `Application`, `ProjectService`, or `Backend`
- `bingen/bingen.go:1` has no companion `*_test.go`
- `logger/logger.go:1` has no companion `*_test.go`

Why this matters:

- the code that glues modules together is where maintenance regressions often happen
- refactors become slower because confidence is concentrated in the leaves, not the branches

Recommendation:

- add contract tests for `ProjectService <-> Backend`
- add backend tests for `SaveProjectToPath`, `LoadProject`, and upload-result shaping
- add package tests for `bingen`
- keep `logger` lightly tested if only for format/level behavior

### 5. Medium: the frontend coverage workflow is currently broken

The package advertises a coverage script, but it does not run in the current repo state.

Evidence:

- `frontend/package.json:12` -> `"test:coverage": "vitest --coverage"`
- running it fails because `@vitest/coverage-v8` is missing

Why this matters:

- coverage cannot be measured consistently
- the package script promises a workflow that the repo does not actually support
- CI adoption is harder if the local developer command already fails

Recommendation:

- add the required Vitest coverage provider dependency and keep the script working
- if coverage is intentionally not used, remove or rename the script

### 6. Low-to-medium: `StateManager` favors simplicity over scaling characteristics

The `StateManager` deep-clones and deep-freezes the full state on each update.

Evidence:

- `frontend/src/core/StateManager.js:319` `update(...)`
- `frontend/src/core/StateManager.js:328` `_deepClone(this._state)`
- `frontend/src/core/StateManager.js:334` `_deepFreeze(draft)`
- `frontend/src/core/StateManager.js:534` `_deepClone`
- `frontend/src/core/StateManager.js:573` `_deepFreeze`

Why this matters:

- it is easy to reason about now
- but it may become a performance and complexity bottleneck as project size, inspector activity, and timeline interactions grow

This is not an immediate correctness issue, and the current code is compensating by excluding `AudioBuffer` and Web Audio objects. I would not rewrite it right away, but I would avoid pushing even more frequently-mutated UI data into the same frozen tree.

## Prioritized Maintenance Plan

If the goal is maintainability without adding features, I would prioritize the cleanup in this order:

1. Replace string-based backend responses with typed DTOs.
2. Break up `main.js` and reduce global `window` event coupling.
3. Split `InspectorRenderer` into smaller sections/components.
4. Add integration/contract tests around `ProjectService`, `Backend`, and `app.go` save/load/upload flows.
5. Fix the frontend coverage script so coverage can actually be tracked.
6. Revisit `StateManager` cloning strategy only after the orchestration cleanup is done.

## Bottom Line

Studio is not in bad shape. It already has better test discipline and better architectural intent than many desktop tools at this stage.

The problem is not lack of effort or lack of abstractions. The problem is that the newer abstractions and the older global orchestration style are both still present, especially in the frontend. That mixed model is the main thing that will make future changes slower and riskier.

If you want this codebase to stay maintainable over the next several iterations, the best investment is not new features. It is reducing the size and coupling of the frontend coordination layer, and then raising tests from "unit coverage on core pieces" to "contract coverage on the seams between them."
