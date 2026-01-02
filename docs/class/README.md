# PicoLume Studio Documentation

This documentation provides a comprehensive guide to the PicoLume Studio codebase architecture, patterns, and APIs.

---

## Overview

PicoLume Studio is a desktop application for creating choreographed LED light shows synced to music. It exports:
- `.lum` files - Project files (ZIP archives) for saving/sharing
- `.bin` files - Compiled binary uploaded to Pico hardware

```
┌─────────────────────────────────────────────────────────────┐
│                    PicoLume Ecosystem                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │   STUDIO    │───▶│   .bin      │───▶│   PICO      │      │
│  │  (This App) │    │   file      │    │  Hardware   │      │
│  └─────────────┘    └─────────────┘    └─────────────┘      │
│        │                                      │              │
│        │            ┌─────────────┐           │              │
│        └───────────▶│   .lum      │           │              │
│                     │   project   │           │              │
│                     └─────────────┘           │              │
│                                               ▼              │
│                                        ┌─────────────┐      │
│                                        │   LED       │      │
│                                        │   Props     │      │
│                                        └─────────────┘      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Documentation Index

### Core Architecture

| Document | Description |
|----------|-------------|
| [Architecture Overview](01-architecture-overview.md) | High-level view of how all pieces connect |
| [Wails Framework](02-wails-framework.md) | How Go and JavaScript communicate |

### Frontend Architecture

| Document | Description |
|----------|-------------|
| [State Management](03-state-management.md) | Centralized state with undo/redo support |
| [Service Layer](04-service-layer.md) | Business logic separated from UI |
| [Controllers](05-controllers.md) | User interaction handling |
| [Rendering Pipeline](06-rendering-pipeline.md) | How the UI is drawn to the screen |

### Data & Integration

| Document | Description |
|----------|-------------|
| [Binary Format](07-binary-format.md) | How projects become bytes for hardware |
| [Backend API Reference](08-backend-api-reference.md) | Complete guide to Go functions callable from JS |

### Reference

| Document | Description |
|----------|-------------|
| [Patterns Index](patterns-index.md) | Design patterns used throughout the codebase |

---

## Quick Reference

### State Shape Reference
See [State Management - State Shape](03-state-management.md#the-state-shape)

### Backend API Cheat Sheet
See [Backend API Reference - Quick Reference](08-backend-api-reference.md#quick-reference)

### Custom Events Reference
See [Controllers - Custom Events](05-controllers.md#custom-events-the-coordination-system)

---

## Prerequisites

To work with this codebase, you should have:
- Basic JavaScript knowledge (variables, functions, classes)
- Basic understanding of HTML/CSS
- Familiarity with async/await patterns

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Desktop Framework | Wails | Bridges Go backend with web frontend |
| Backend | Go | File I/O, hardware communication, binary generation |
| Frontend | Vanilla JavaScript | UI rendering, state management, user interaction |
| Styling | CSS | Theming, layout, animations |

---

## Key Concepts

### Single Source of Truth
All application data lives in `StateManager`. Components either read from it, write to it, or react to changes in it.

### Unidirectional Data Flow
```
User Input → Controller → Service → StateManager → Renderer → DOM
```

### Separation of Concerns
- **Controllers** handle user input and orchestrate actions
- **Services** contain business logic
- **Renderers** draw the UI based on state
- **StateManager** maintains all application data
