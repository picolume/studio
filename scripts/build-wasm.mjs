#!/usr/bin/env node
// Builds the WASM binary generator and copies Go's wasm_exec.js shim.
// Cross-platform; runs as part of the frontend build so the committed
// bingen.wasm can never drift from the Go source in a packaged build.
//
// Usage: node scripts/build-wasm.mjs (or `npm run build:wasm` in frontend/)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const studioDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmDir = join(studioDir, 'frontend', 'src', 'wasm');
const wasmOutput = join(wasmDir, 'bingen.wasm');

mkdirSync(wasmDir, { recursive: true });

console.log('Building WASM module...');
execFileSync('go', ['build', '-o', wasmOutput, './wasm'], {
    cwd: studioDir,
    stdio: 'inherit',
    env: { ...process.env, GOOS: 'js', GOARCH: 'wasm' }
});
console.log(`  Created: ${wasmOutput}`);

const goroot = execFileSync('go', ['env', 'GOROOT'], { encoding: 'utf8' }).trim();
const wasmExecCandidates = [
    join(goroot, 'lib', 'wasm', 'wasm_exec.js'), // Go 1.24+
    join(goroot, 'misc', 'wasm', 'wasm_exec.js') // older Go versions
];
const wasmExecSrc = wasmExecCandidates.find(existsSync);
if (wasmExecSrc) {
    copyFileSync(wasmExecSrc, join(wasmDir, 'wasm_exec.js'));
    console.log('  Copied: wasm_exec.js');
} else {
    console.warn('  Warning: wasm_exec.js not found in GOROOT; keeping the existing copy.');
}

console.log('WASM build complete.');
