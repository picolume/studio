# Cue-Based Resync (Studio + Remote + Receiver) - Proposal

Status: proposal

## Problem
During performance, music tempo drift can cause the light show to fall out of sync. We need operator-controlled resync points that can jump the show time back to a known musical hit.

## Goals
- Provide up to 4 user-defined cue points in the timeline.
- Allow an operator to jump playback time to a cue during a live show.
- Preserve the existing V3 show.bin layout for receivers.

## Non-goals
- Automated tempo tracking or beat detection.
- Continuous time stretching or auto-correction.
- Unlimited cues.

## User Experience (Studio)
- Timeline shows 4 cue markers labeled A-D.
- Each cue can be set by placing the playhead and clicking "Set Cue A/B/C/D".
- Cues are draggable and snap to grid.
- Inspector lists cue times and lets the user enable or clear each cue.
- Export includes cue data in show.bin.

## Live Operation (Remote)
- Remote has 4 dedicated cue buttons (A-D).
- While playing: pressing a cue immediately sets master time to that cue time and continues playback.
- While stopped: pressing a cue sets the next start time; Play starts from that cue.
- If a cue is not defined: ignore and optionally show a short LCD message.

## Data Model (Project JSON)
Add a cues field with 4 entries:
- id: "A" | "B" | "C" | "D"
- timeMs: number or null
- enabled: boolean

Example:
{
  "cues": [
    { "id": "A", "timeMs": 12345, "enabled": true },
    { "id": "B", "timeMs": 45678, "enabled": true },
    { "id": "C", "timeMs": null,  "enabled": false },
    { "id": "D", "timeMs": null,  "enabled": false }
  ]
}

## show.bin Format (V3 + optional trailing cue block)
Keep V3 header/LUT/events unchanged. Append an optional CUE block at end of file.

Cue block layout (little-endian):
- magic[4] = "CUE1" (0x43 0x55 0x45 0x31)
- version u16 = 1
- count u16 = 4
- times[4] u32 (ms). Use 0xFFFFFFFF for unused.
- reserved[8] bytes (future use, set to 0)

Total block size: 32 bytes.

Remote detection: read last 32 bytes and check magic. If missing, cues are absent.

## Remote Firmware Behavior
- Parse cue block when loading show.bin.
- Store cue times in RAM.
- On cue button press, set masterTime to cue time and broadcast immediately.
- Keep existing play/stop behavior and timecode broadcast.

## Receiver Firmware Behavior
No change required. Receivers follow master timecode and will jump to the new time automatically.

## Compatibility
- Old receivers ignore trailing bytes and remain compatible.
- Old remotes ignore cues if they do not parse the block.
- New remote works with old show.bin files (no cue block).

## Edge Cases
- Cue time beyond show duration: clamp or ignore (decision needed).
- Duplicate cue times: allowed; no special handling.
- Show with zero events: still allow cues.

## Simple UI Flow
1. User loads a project.
2. User sets cue A by moving the playhead and clicking "Set Cue A".
3. Timeline shows marker A; user can drag to adjust.
4. Repeat for B/C/D as needed.
5. User exports show.bin; cue block is appended.
6. Remote loads show.bin and enables cue buttons.
7. During performance, operator presses cue button to resync to the marked hit.
