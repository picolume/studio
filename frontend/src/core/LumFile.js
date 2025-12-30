import { zipFiles, unzipFiles } from './ZipUtil.js';

const LUM_LIMITS = Object.freeze({
    maxZipBytes: 500 * 1024 * 1024,          // 500MB
    maxProjectJsonBytes: 10 * 1024 * 1024,   // 10MB
    maxAudioFileBytes: 200 * 1024 * 1024,    // 200MB
    maxTotalExtractedBytes: 1024 * 1024 * 1024, // 1GB
    maxEntries: 100,
});

function extFromMime(mime) {
    const lower = (mime || '').toLowerCase();
    if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
    if (lower.includes('wav')) return 'wav';
    if (lower.includes('ogg')) return 'ogg';
    return 'bin';
}

function mimeFromExt(ext) {
    const lower = (ext || '').toLowerCase();
    if (lower === 'mp3' || lower === 'mpeg') return 'audio/mpeg';
    if (lower === 'wav') return 'audio/wav';
    if (lower === 'ogg') return 'audio/ogg';
    return 'audio/mpeg';
}

function parseDataUrlMeta(dataUrl) {
    const idx = dataUrl.indexOf(',');
    if (idx < 0) return { mime: 'application/octet-stream', isBase64: false, data: '' };
    const meta = dataUrl.slice(0, idx);
    const data = dataUrl.slice(idx + 1);
    const mime = meta.startsWith('data:') ? meta.slice(5).split(';')[0] : 'application/octet-stream';
    const isBase64 = meta.includes(';base64');
    return { mime, isBase64, data };
}

async function dataUrlToBytes(dataUrl) {
    // Use fetch() to avoid huge atob() strings for large audio.
    const res = await fetch(dataUrl);
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab);
}

async function bytesToDataUrl(bytes, mime) {
    return await new Promise((resolve, reject) => {
        try {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Failed to read blob'));
            reader.readAsDataURL(new Blob([bytes], { type: mime }));
        } catch (err) {
            reject(err);
        }
    });
}

export async function createLumBytes(projectJson, audioFiles, { compress = false } = {}) {
    const files = {
        'project.json': new TextEncoder().encode(projectJson)
    };

    for (const [id, dataUrl] of Object.entries(audioFiles || {})) {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) continue;
        const meta = parseDataUrlMeta(dataUrl);
        if (!meta.isBase64) continue;
        const ext = extFromMime(meta.mime);
        const bytes = await dataUrlToBytes(dataUrl);
        files[`audio/${id}.${ext}`] = bytes;
    }

    return await zipFiles(files, { compress });
}

export async function parseLumBytes(zipBytes) {
    const files = await unzipFiles(zipBytes, {
        maxZipBytes: LUM_LIMITS.maxZipBytes,
        maxEntries: LUM_LIMITS.maxEntries,
        maxTotalUncompressedBytes: LUM_LIMITS.maxTotalExtractedBytes,
        shouldExtract: (name) => name === 'project.json' || name.startsWith('audio/'),
        maxUncompressedBytesForFile: (name) => {
            if (name === 'project.json') return LUM_LIMITS.maxProjectJsonBytes;
            if (name.startsWith('audio/')) return LUM_LIMITS.maxAudioFileBytes;
            return 0;
        }
    });

    const projectJsonBytes = files['project.json'];
    if (!projectJsonBytes) {
        throw new Error('Invalid .lum: missing project.json');
    }
    const projectJson = new TextDecoder('utf-8').decode(projectJsonBytes);

    const audioFiles = {};
    for (const [name, bytes] of Object.entries(files)) {
        if (!name.startsWith('audio/')) continue;
        const baseName = name.split('/').pop() || '';
        const parts = baseName.split('.');
        if (parts.length < 2) continue;
        const id = parts.slice(0, -1).join('.');
        const ext = parts[parts.length - 1];
        const mime = mimeFromExt(ext);
        audioFiles[id] = await bytesToDataUrl(bytes, mime);
    }

    return { projectJson, audioFiles };
}
