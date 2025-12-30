# PicoLume Studio

**The Open Source Wireless Lighting Platform for the Marching Arts.**

PicoLume Studio is a timeline sequencer designed specifically for marching bands, drum corps, and winter guards. It bridges the gap between expensive professional DMX gear and fragile DIY hobbyist projects.

Designed to work with the **PicoLume Hardware Ecosystem**, it allows directors and designers to choreograph complex lighting shows synchronized to music without writing a single line of code.

## Why PicoLume?

Traditional lighting solutions (like WLED) are **state-based** (Turn On / Turn Off). Marching bands are **time-based**.

PicoLume Studio provides a video-editor-style timeline that allows you to:

- **Visualize:** See your lighting effects alongside the audio waveform.
- **Group:** Organize hundreds of props into logical groups (e.g., "Snares," "Trumpets," "Color Guard").
- **Compile:** Export optimized binary instructions ensuring perfect sync on low-cost hardware.

## Features

- **Cross-Platform:** Built with [Wails](https://wails.io/) (Go + Web Technologies), running natively on Windows, macOS, and Linux.
- **Smart Patching:** decoupled hardware addresses from logical groups. Swap a broken receiver without reprogramming the show.
- **Binary Compilation:** Compiles shows into a lightweight binary format (`.bin`) optimized for the RP2040 microcontroller.
- **Auto-Upload:** One-click upload and reset for PicoLume devices via USB. On Windows, automatically ejects the USB drive for maximum reliability.

## The Ecosystem

PicoLume is more than just software. It is a complete ecosystem:

- **[PicoLume Firmware](https://github.com/picolume/firmware):** (Coming Soon) The C/C++ firmware for the RP2040 and RFM69 radio modules.
- **[PicoLume Hardware](https://github.com/picolume/hardware):** (Coming Soon) Open-source KiCad PCB designs for the wireless badges.

## Development Setup

PicoLume Studio is built using **Wails**. To run it locally:

### Prerequisites

- [Go 1.21+](https://go.dev/)
- [Node.js](https://nodejs.org/) (npm)
- [Wails CLI](https://wails.io/docs/gettingstarted/installation)

### Run in Dev Mode

```bash
wails dev
```

## Learn the Codebase

If you want a course-style walkthrough of how PicoLume Studio works (architecture, patterns, backend API, file formats), see:

- `studio/docs/class/README.md`
