# Design Patterns Index

This document catalogs all the design patterns used in PicoLume Studio, with links to where they appear in the codebase and lessons.

---

## Creational Patterns

### Dependency Injection

**What:** Components receive their dependencies rather than creating them.

**Where Used:**
- `Application.js` - Creates all services and injects them into controllers
- `ProjectService` - Receives StateManager, AudioService, ErrorHandler
- `TimelineController` - Receives StateManager, AudioService

**Lesson:** [Lesson 4: Service Layer](04-service-layer.md#service-initialization)

**Example:**
```javascript
// Application creates services
this.audioService = new AudioService(this.stateManager);
this.projectService = new ProjectService(
    this.stateManager,
    this.audioService,
    this.errorHandler
);
```

---

## Structural Patterns

### Adapter Pattern

**What:** Wraps an interface to make it compatible with another expected interface.

**Where Used:**
- `Backend.js` - Adapts Wails backend and Browser APIs to common interface

**Lesson:** [Lesson 2: Wails Framework](02-wails-framework.md#the-backend-adapter-pattern)

**Example:**
```javascript
class WailsBackend {
    async saveProjectToPath(path, json, audio) {
        return window.go.main.App.SaveProjectToPath(path, json, audio);
    }
}

class OnlineBackend {
    async saveProjectToPath(path, json, audio) {
        // Use File System Access API instead
    }
}
```

### Facade Pattern

**What:** Provides a simplified interface to a complex subsystem.

**Where Used:**
- `ProjectService` - Simplifies save/load operations
- `AudioService` - Hides Web Audio API complexity

**Lesson:** [Lesson 4: Service Layer](04-service-layer.md)

---

## Behavioral Patterns

### Observer Pattern

**What:** Objects subscribe to events/changes and get notified automatically.

**Where Used:**
- `StateManager` - Components subscribe to state changes
- Custom DOM events - `app:timeline-changed`, `app:selection-changed`

**Lesson:** [Lesson 3: State Management](03-state-management.md#the-observer-pattern)

**Example:**
```javascript
// Subscribe to all changes
stateManager.subscribe((newState, oldState) => {
    console.log('State changed');
});

// Subscribe to specific path
stateManager.subscribeTo('ui.zoom', (newZoom) => {
    redrawTimeline();
});
```

### Pub/Sub (Publish-Subscribe)

**What:** Publishers emit events, subscribers listen without knowing each other.

**Where Used:**
- Custom events throughout the app
- Wails events from Go backend

**Lesson:** [Lesson 5: Controllers](05-controllers.md#custom-events-the-coordination-system)

**Example:**
```javascript
// Publisher
window.dispatchEvent(new CustomEvent('app:timeline-changed'));

// Subscriber
window.addEventListener('app:timeline-changed', () => this.render());
```

### Command Pattern

**What:** Encapsulates actions as objects for undo/redo.

**Where Used:**
- `StateManager` - State snapshots enable undo/redo

**Lesson:** [Lesson 3: State Management](03-state-management.md#the-undoredo-system)

### Strategy Pattern

**What:** Defines a family of algorithms, encapsulates each one, makes them interchangeable.

**Where Used:**
- Effect rendering in `PreviewRenderer` - Different algorithms per effect type

**Lesson:** [Lesson 6: Rendering Pipeline](06-rendering-pipeline.md#the-rendering-loop)

**Example:**
```javascript
calculateEffectColor(clip, ledIndex, elapsed, progress) {
    switch (clip.type) {
        case 'solid': return clip.props.color;
        case 'rainbow': return calculateRainbow(ledIndex, elapsed);
        case 'chase': return calculateChase(ledIndex, elapsed);
        // ...
    }
}
```

---

## Architectural Patterns

### Single Source of Truth

**What:** All application state lives in one place.

**Where Used:**
- `StateManager` - Central state container

**Lesson:** [Lesson 3: State Management](03-state-management.md)

### Unidirectional Data Flow

**What:** Data flows one direction through the application.

**Where Used:**
- User Action → Controller → Service → State → View

**Lesson:** [Lesson 1: Architecture Overview](01-architecture-overview.md#mental-model-the-assembly-line)

```
User Input → Controller → Service → StateManager → Renderer → DOM
```

### MVC-ish (Model-View-Controller)

**What:** Separation of data (Model), presentation (View), and logic (Controller).

**Where Used:**
- StateManager = Model
- Renderers = Views
- Controllers = Controllers
- Services = Model helpers

**Lesson:** [Lesson 1: Architecture Overview](01-architecture-overview.md)

---

## Resilience Patterns

### Retry with Exponential Backoff

**What:** Retry failed operations with increasing delays.

**Where Used:**
- `AudioService` - Audio decode retries
- `UploadToPico` - Serial port retries

**Lesson:** [Lesson 4: Service Layer](04-service-layer.md#the-retry-pattern)

**Example:**
```javascript
async function withRetry(fn, { maxRetries = 2, baseDelayMs = 500 }) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries) throw error;
            const delay = baseDelayMs * Math.pow(2, attempt);
            await sleep(delay);
        }
    }
}
```

### Timeout Pattern

**What:** Wrap async operations with timeouts to prevent hangs.

**Where Used:**
- `AudioService` - All async operations

**Lesson:** [Lesson 4: Service Layer](04-service-layer.md#the-timeout-pattern)

---

## UI Patterns

### Debouncing

**What:** Delay execution until user stops an activity.

**Where Used:**
- Auto-save (2 second delay after changes)
- Timeline input validation

**Example:**
```javascript
let saveTimer = null;
stateManager.subscribeTo('isDirty', (dirty) => {
    if (dirty) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => projectService.save(), 2000);
    }
});
```

### Throttling

**What:** Limit execution to once per time period.

**Where Used:**
- `PreviewRenderer` - ~60fps cap during playback

**Lesson:** [Lesson 6: Rendering Pipeline](06-rendering-pipeline.md#throttling-for-performance)

### Optimistic UI Updates

**What:** Update UI immediately, before backend confirms.

**Where Used:**
- Drag operations - Direct DOM manipulation, state commit on drop

**Lesson:** [Lesson 6: Rendering Pipeline](06-rendering-pipeline.md#clip-dragging-moveresize)

---

## Data Patterns

### Immutability

**What:** Never modify existing data, create new copies instead.

**Where Used:**
- `StateManager` - All updates create new state objects

**Lesson:** [Lesson 3: State Management](03-state-management.md#immutability-why-it-matters)

### Data URL Encoding

**What:** Embed binary data as base64 in URLs.

**Where Used:**
- Audio file storage in state
- Project save/load

**Example:**
```
data:audio/mp3;base64,//uQxAAAAAANIAAAAAExBTU...
```

---

## Pattern Cross-Reference by File

| File | Patterns Used |
|------|---------------|
| `StateManager.js` | Observer, Immutability, Command (undo) |
| `Application.js` | Dependency Injection, Facade |
| `Backend.js` | Adapter |
| `ProjectService.js` | Facade, Retry |
| `AudioService.js` | Facade, Retry, Timeout |
| `TimelineController.js` | Observer, Pub/Sub |
| `PreviewRenderer.js` | Observer, Strategy, Throttling |
| `TimelineRenderer.js` | Observer, Optimistic UI |

---

## When to Use Each Pattern

| Situation | Pattern |
|-----------|---------|
| Components need central data | Single Source of Truth |
| UI needs to update on data change | Observer |
| Operations might fail temporarily | Retry with Backoff |
| Operations might hang | Timeout |
| Different implementations, same interface | Adapter/Strategy |
| Components shouldn't know about each other | Pub/Sub |
| Need undo/redo | Immutability + Command |
| UI feels slow | Optimistic Updates, Throttling |

---

[← Back to Course Index](README.md)
