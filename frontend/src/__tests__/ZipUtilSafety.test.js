import { describe, it, expect } from 'vitest';
import { zipFiles, unzipFiles } from '../core/ZipUtil.js';

describe('ZipUtil safety limits', () => {
    it('rejects zips with too many entries', async () => {
        const zip = await zipFiles(
            {
                'a.txt': new TextEncoder().encode('a'),
                'b.txt': new TextEncoder().encode('b'),
                'c.txt': new TextEncoder().encode('c'),
            },
            { compress: false }
        );

        await expect(
            unzipFiles(zip, { maxEntries: 2 })
        ).rejects.toThrow(/too many files/i);
    });

    it('rejects unsafe zip paths', async () => {
        const zip = await zipFiles(
            {
                '../evil.txt': new TextEncoder().encode('nope'),
            },
            { compress: false }
        );

        await expect(unzipFiles(zip)).rejects.toThrow(/invalid zip path/i);
    });

    it('enforces per-file uncompressed limits', async () => {
        const zip = await zipFiles(
            {
                'project.json': new TextEncoder().encode('0123456789ABCDEF'),
            },
            { compress: false }
        );

        await expect(
            unzipFiles(zip, {
                maxEntries: 10,
                maxTotalUncompressedBytes: 100,
                maxUncompressedBytesForFile: (name) => (name === 'project.json' ? 10 : 100),
            })
        ).rejects.toThrow(/entry too large/i);
    });

    it('enforces total extracted size limits', async () => {
        const zip = await zipFiles(
            {
                'a.bin': new Uint8Array(8),
                'b.bin': new Uint8Array(8),
            },
            { compress: false }
        );

        await expect(
            unzipFiles(zip, { maxTotalUncompressedBytes: 10 })
        ).rejects.toThrow(/total extracted size/i);
    });
});

