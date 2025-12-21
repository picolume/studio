import { zipFiles, unzipFiles } from './ZipUtil.js';

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

function bytesToBase64(bytes) {
    const chunkSize = 0x8000;
    let binary = '';
    let out = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary = '';
        for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j]);
        out += btoa(binary);
    }
    return out;
}

function bytesToDataUrl(bytes, mime) {
    const b64 = bytesToBase64(bytes);
    return `data:${mime};base64,${b64}`;
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
    const files = await unzipFiles(zipBytes);

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
        const id = parts[0];
        const ext = parts[parts.length - 1];
        const mime = mimeFromExt(ext);
        audioFiles[id] = bytesToDataUrl(bytes, mime);
    }

    return { projectJson, audioFiles };
}
