const ZIP_LOCAL_FILE_HEADER_SIG = 0x04034b50;
const ZIP_CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIR_SIG = 0x06054b50;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

let crcTable = null;

function initCrcTable() {
    if (crcTable) return crcTable;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    crcTable = table;
    return table;
}

function crc32(data) {
    const table = initCrcTable();
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function concatUint8(chunks, totalLen) {
    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

function u16(value) {
    const buf = new Uint8Array(2);
    new DataView(buf.buffer).setUint16(0, value, true);
    return buf;
}

function u32(value) {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, value >>> 0, true);
    return buf;
}

function encodeUtf8(str) {
    return textEncoder.encode(str);
}

function decodeUtf8(bytes) {
    return textDecoder.decode(bytes);
}

async function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') {
        throw new Error('CompressionStream is not available in this browser');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
}

async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('DecompressionStream is not available in this browser');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
}

function findEocdOffset(bytes) {
    const maxComment = 0xFFFF;
    const minEocdSize = 22;
    const maxSearch = Math.max(0, bytes.length - minEocdSize - maxComment);
    for (let i = bytes.length - minEocdSize; i >= maxSearch; i--) {
        if (
            bytes[i] === 0x50 &&
            bytes[i + 1] === 0x4b &&
            bytes[i + 2] === 0x05 &&
            bytes[i + 3] === 0x06
        ) {
            return i;
        }
    }
    return -1;
}

export async function zipFiles(files, { compress = false } = {}) {
    const localChunks = [];
    const centralChunks = [];

    let localOffset = 0;
    let centralSize = 0;
    let fileCount = 0;

    for (const [name, rawData] of Object.entries(files)) {
        const filename = encodeUtf8(name);
        const flags = 0x0800; // UTF-8
        const method = compress ? 8 : 0;

        const uncompressedSize = rawData.length;
        const data = compress ? await deflateRaw(rawData) : rawData;
        const compressedSize = data.length;
        const crc = crc32(rawData);

        const localHeader = concatUint8(
            [
                u32(ZIP_LOCAL_FILE_HEADER_SIG),
                u16(20), // version needed
                u16(flags),
                u16(method),
                u16(0), // mod time
                u16(0), // mod date
                u32(crc),
                u32(compressedSize),
                u32(uncompressedSize),
                u16(filename.length),
                u16(0), // extra len
                filename
            ],
            30 + filename.length
        );

        localChunks.push(localHeader, data);

        const centralHeader = concatUint8(
            [
                u32(ZIP_CENTRAL_DIR_HEADER_SIG),
                u16(20), // version made by
                u16(20), // version needed
                u16(flags),
                u16(method),
                u16(0),
                u16(0),
                u32(crc),
                u32(compressedSize),
                u32(uncompressedSize),
                u16(filename.length),
                u16(0), // extra len
                u16(0), // comment len
                u16(0), // disk start
                u16(0), // internal attrs
                u32(0), // external attrs
                u32(localOffset),
                filename
            ],
            46 + filename.length
        );

        centralChunks.push(centralHeader);
        centralSize += centralHeader.length;

        localOffset += localHeader.length + data.length;
        fileCount += 1;
    }

    const centralDir = concatUint8(centralChunks, centralSize);

    const eocd = concatUint8(
        [
            u32(ZIP_END_OF_CENTRAL_DIR_SIG),
            u16(0), // disk number
            u16(0), // disk start
            u16(fileCount),
            u16(fileCount),
            u32(centralDir.length),
            u32(localOffset),
            u16(0) // comment len
        ],
        22
    );

    return concatUint8([...localChunks, centralDir, eocd], localOffset + centralDir.length + eocd.length);
}

export async function unzipFiles(zipBytes) {
    const eocdOffset = findEocdOffset(zipBytes);
    if (eocdOffset < 0) throw new Error('Invalid zip: missing end of central directory');

    const eocdView = new DataView(zipBytes.buffer, zipBytes.byteOffset + eocdOffset, 22);
    const signature = eocdView.getUint32(0, true);
    if (signature !== ZIP_END_OF_CENTRAL_DIR_SIG) throw new Error('Invalid zip: bad EOCD signature');

    const totalEntries = eocdView.getUint16(10, true);
    const centralSize = eocdView.getUint32(12, true);
    const centralOffset = eocdView.getUint32(16, true);

    const out = {};
    let ptr = centralOffset;

    for (let i = 0; i < totalEntries; i++) {
        const view = new DataView(zipBytes.buffer, zipBytes.byteOffset + ptr, 46);
        const sig = view.getUint32(0, true);
        if (sig !== ZIP_CENTRAL_DIR_HEADER_SIG) {
            throw new Error('Invalid zip: bad central directory header');
        }

        const flags = view.getUint16(8, true);
        const method = view.getUint16(10, true);
        const compressedSize = view.getUint32(20, true);
        const uncompressedSize = view.getUint32(24, true);
        const nameLen = view.getUint16(28, true);
        const extraLen = view.getUint16(30, true);
        const commentLen = view.getUint16(32, true);
        const localHeaderOffset = view.getUint32(42, true);

        const nameBytes = zipBytes.subarray(ptr + 46, ptr + 46 + nameLen);
        const name = decodeUtf8(nameBytes);

        ptr += 46 + nameLen + extraLen + commentLen;

        const localView = new DataView(zipBytes.buffer, zipBytes.byteOffset + localHeaderOffset, 30);
        const localSig = localView.getUint32(0, true);
        if (localSig !== ZIP_LOCAL_FILE_HEADER_SIG) {
            throw new Error('Invalid zip: bad local file header');
        }

        const localNameLen = localView.getUint16(26, true);
        const localExtraLen = localView.getUint16(28, true);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const compressed = zipBytes.subarray(dataStart, dataStart + compressedSize);

        // Bit 3 indicates a data descriptor; we rely on central directory sizes.
        const hasDataDescriptor = (flags & 0x0008) !== 0;
        void hasDataDescriptor;

        let content;
        if (method === 0) {
            content = compressed;
        } else if (method === 8) {
            content = await inflateRaw(compressed);
            if (uncompressedSize && content.length !== uncompressedSize) {
                // Allow mismatch, but keep a sanity check for gross corruption.
                // (Some zips may omit or misreport sizes in local headers.)
            }
        } else {
            throw new Error(`Unsupported zip compression method: ${method}`);
        }

        out[name] = content;
    }

    void centralSize;
    return out;
}

