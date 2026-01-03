import { describe, it, expect } from 'vitest';
import { parseShowBin } from '../core/ShowBinParser.js';

function writeU32LE(bytes, offset, value) {
  bytes[offset + 0] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writeU16LE(bytes, offset, value) {
  bytes[offset + 0] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

describe('ShowBinParser.parseShowBin', () => {
  it('parses optional CUE1 trailer', () => {
    const headerSize = 16;
    const lutSize = 224 * 8;
    const eventSize = 48;
    const eventCount = 1;
    const cueSize = 32;

    const totalSize = headerSize + lutSize + eventSize * eventCount + cueSize;
    const bytes = new Uint8Array(totalSize);

    // Header
    writeU32LE(bytes, 0, 0x5049434f); // "PICO"
    writeU16LE(bytes, 4, 3);
    writeU16LE(bytes, 6, eventCount);

    // Single event (all zeros is fine)

    // Cue block at end
    const cueBase = totalSize - cueSize;
    writeU32LE(bytes, cueBase + 0, 0x31455543); // "CUE1" u32 little-endian
    writeU16LE(bytes, cueBase + 4, 1); // version
    writeU16LE(bytes, cueBase + 6, 4); // count
    writeU32LE(bytes, cueBase + 8, 1234); // A
    writeU32LE(bytes, cueBase + 12, 0xffffffff); // B unused
    writeU32LE(bytes, cueBase + 16, 5678); // C
    writeU32LE(bytes, cueBase + 20, 0xffffffff); // D unused

    const parsed = parseShowBin(bytes);
    expect(parsed.error).toBeUndefined();
    expect(parsed.cueBlock).toBeTruthy();
    expect(parsed.cueBlock.base).toBe(cueBase);
    expect(parsed.cueBlock.version).toBe(1);
    expect(parsed.cueBlock.count).toBe(4);
    expect(parsed.cueBlock.times).toEqual({ A: 1234, B: null, C: 5678, D: null });
    expect(parsed.trailingBytes).toBe(cueSize);
  });
});

