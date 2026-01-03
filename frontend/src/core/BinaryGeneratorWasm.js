/**
 * WASM-based binary generator for PicoLume show.bin files.
 * Uses Go compiled to WebAssembly for consistent binary generation across desktop (Wails) and web.
 */

let wasmReady = false;
let wasmInitPromise = null;
let goRuntime = null;

/**
 * Initialize the WASM module.
 * Call this once at app startup.
 * @returns {Promise<void>}
 */
export async function initWasm() {
    if (wasmReady) return;
    if (wasmInitPromise) return wasmInitPromise;

    wasmInitPromise = (async () => {
        try {
            // Load Go's WASM runtime shim (non-module script).
            if (!window.Go) {
                await loadScript(getWasmExecUrl().toString());
            }

            const go = new window.Go();
            goRuntime = go;

            const wasmUrl = getWasmUrl();
            const result = await instantiateWasmWithFallback(wasmUrl, go.importObject);

            // go.run() resolves when the program exits; our WASM module never exits (select{}),
            // so do NOT await it.
            go.run(result.instance);

            await waitForPicolume();
            wasmReady = true;
        } catch (err) {
            wasmReady = false;
            wasmInitPromise = null;
            goRuntime = null;
            throw err;
        }
    })();

    return wasmInitPromise;
}

/**
 * Resolve a URL for wasm_exec.js relative to this module (works under subpaths).
 */
function getWasmExecUrl() {
    return new URL('../wasm/wasm_exec.js', import.meta.url);
}

/**
 * Resolve a URL for the WASM binary relative to this module (works under subpaths).
 */
function getWasmUrl() {
    return new URL('../wasm/bingen.wasm', import.meta.url);
}

async function instantiateWasmWithFallback(wasmUrl, importObject) {
    const response = await fetch(wasmUrl.toString());
    if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
    }

    // instantiateStreaming frequently fails on hosts that don't serve application/wasm.
    if (WebAssembly.instantiateStreaming) {
        const responseClone = response.clone();
        try {
            return await WebAssembly.instantiateStreaming(response, importObject);
        } catch {
            const bytes = await responseClone.arrayBuffer();
            return await WebAssembly.instantiate(bytes, importObject);
        }
    }

    const bytes = await response.arrayBuffer();
    return await WebAssembly.instantiate(bytes, importObject);
}

/**
 * Load an external script dynamically.
 */
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

/**
 * Wait for the picolume namespace to be available.
 */
function waitForPicolume(timeout = 5000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            if (window.picolume?.generateBinaryBytes) {
                resolve();
            } else if (Date.now() - start > timeout) {
                reject(new Error('Timeout waiting for WASM module'));
            } else {
                setTimeout(check, 10);
            }
        };
        check();
    });
}

/**
 * Check if WASM is ready for use.
 * @returns {boolean}
 */
export function isWasmReady() {
    return wasmReady;
}

/**
 * Generate show.bin bytes from a project object using WASM.
 *
 * @param {Object} project - The project data
 * @returns {{ bytes: Uint8Array, eventCount: number }}
 */
export function generateBinaryBytes(project) {
    if (!wasmReady || !window.picolume?.generateBinaryBytes) {
        throw new Error('WASM binary generator not initialized');
    }

    const projectJson = JSON.stringify(project);
    const result = window.picolume.generateBinaryBytes(projectJson);

    if (result.error) {
        throw new Error(`WASM binary generation failed: ${result.error}`);
    }

    return {
        bytes: result.bytes,
        eventCount: result.eventCount
    };
}

/**
 * Generate show.bin bytes asynchronously, ensuring WASM is initialized.
 *
 * @param {Object} project - The project data
 * @returns {Promise<{ bytes: Uint8Array, eventCount: number }>}
 */
export async function generateBinaryBytesAsync(project) {
    await initWasm();
    return generateBinaryBytes(project);
}

/**
 * Generate show.bin bytes in base64 form using WASM (useful for Wails bridging).
 *
 * @param {Object} project - The project data
 * @returns {{ base64: string, eventCount: number }}
 */
export function generateBinaryBase64(project) {
    if (!wasmReady || !window.picolume?.generateBinaryBase64) {
        throw new Error('WASM binary generator not initialized');
    }

    const projectJson = JSON.stringify(project);
    const result = window.picolume.generateBinaryBase64(projectJson);

    if (result.error) {
        throw new Error(`WASM binary generation failed: ${result.error}`);
    }

    return {
        base64: result.base64,
        eventCount: result.eventCount
    };
}

export async function generateBinaryBase64Async(project) {
    await initWasm();
    return generateBinaryBase64(project);
}

