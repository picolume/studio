package main

import (
	"io/fs"
	"testing"
)

// TestEmbeddedAssetsContainRuntimeFiles guards the go:embed directive: the
// app serves these files at runtime, so they must exist in the embedded tree.
func TestEmbeddedAssetsContainRuntimeFiles(t *testing.T) {
	sub := getAssets()
	required := []string{
		"index.html",
		"manual.html",
		"interface.jpg",
		"src/main.js",
		"src/wasm/bingen.wasm",
		"src/wasm/wasm_exec.js",
		"src/assets/fontawsome/all.min.css",
	}
	for _, name := range required {
		if _, err := fs.Stat(sub, name); err != nil {
			t.Errorf("expected embedded asset %q: %v", name, err)
		}
	}
}

// TestEmbeddedAssetsExcludeNodeModules ensures dev dependencies never ship
// inside the binary again (~44MB of bloat when they did).
func TestEmbeddedAssetsExcludeNodeModules(t *testing.T) {
	sub := getAssets()
	if _, err := fs.Stat(sub, "node_modules"); err == nil {
		t.Error("node_modules must not be embedded in the binary")
	}
}
