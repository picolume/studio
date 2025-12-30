# PicoLume Studio: A Deep Dive Course

**Welcome, Student!**

This course is designed to take you from "I built this with AI" to "I deeply understand how this works." By the end, you'll be able to:

- Explain the architecture to another developer
- Confidently modify any part of the codebase
- Recognize the patterns used and apply them elsewhere
- Know exactly what backend functions are available for frontend work

---

## Course Philosophy

This isn't a typical tutorial. We'll use:

1. **Analogies** - Relating complex concepts to everyday things
2. **Mermaid Diagrams** - Visual representations of code flow
3. **Pattern Recognition** - Highlighting where the same ideas repeat
4. **"Why" Over "What"** - Understanding decisions, not just facts

---

## Prerequisites

- Basic JavaScript knowledge (variables, functions, classes)
- Basic understanding of HTML/CSS
- Willingness to read code alongside these lessons

---

## Course Outline

### Unit 1: The Big Picture

| Lesson | Title | What You'll Learn |
|--------|-------|-------------------|
| [01](01-architecture-overview.md) | **Architecture Overview** | The 30,000-foot view of how all the pieces connect |
| [02](02-wails-framework.md) | **The Wails Framework** | How Go and JavaScript talk to each other |

### Unit 2: Frontend Patterns

| Lesson | Title | What You'll Learn |
|--------|-------|-------------------|
| [03](03-state-management.md) | **State Management** | How we track everything that changes in the app |
| [04](04-service-layer.md) | **The Service Layer** | Business logic separated from UI |
| [05](05-controllers.md) | **Controllers** | Orchestrating user interactions |
| [06](06-rendering-pipeline.md) | **The Rendering Pipeline** | How pixels get to the screen |

### Unit 3: Data & Integration

| Lesson | Title | What You'll Learn |
|--------|-------|-------------------|
| [07](07-binary-format.md) | **Binary Format & Serialization** | How shows become bytes for hardware |
| [08](08-backend-api-reference.md) | **Backend API Reference** | Complete guide to Go functions you can call |

---

## How to Use This Course

### Recommended Approach

1. **Read the lesson** - Get the concepts
2. **Open the referenced files** - See the real code
3. **Trace a feature** - Pick something (like "save project") and follow it through
4. **Modify something small** - Best way to confirm understanding

### Time Investment

Each lesson is designed to take 30-60 minutes of focused study. Don't rush - the goal is deep understanding, not completion.

---

## Quick Reference Cards

After completing the course, you'll have these reference materials:

- [Backend API Cheat Sheet](08-backend-api-reference.md#quick-reference) - All Go functions callable from JS
- [State Shape Reference](03-state-management.md#state-shape) - What data lives where
- [Event Reference](05-controllers.md#custom-events) - All custom events in the system
- [Pattern Index](patterns-index.md) - Where each pattern is used

---

## The PicoLume Ecosystem

Before diving in, remember what we're building:

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

**Studio** creates choreographed light shows synced to music. It exports:
- `.lum` files - Project files (ZIP archives) for saving/sharing
- `.bin` files - Compiled binary uploaded to Pico hardware

The Pico hardware reads the binary and drives LED strips wirelessly.

---

## Let's Begin!

Ready? Start with [Lesson 1: Architecture Overview](01-architecture-overview.md)

---

*This course was created to help you truly understand the codebase you've built. Take your time, ask questions, and enjoy the journey from user to expert.*
