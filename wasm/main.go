//go:build js && wasm

// WASM entry point for PicoLume binary generator.
// Compile with: GOOS=js GOARCH=wasm go build -o bingen.wasm ./wasm
package main

import (
	"encoding/base64"
	"syscall/js"

	"PicoLume/bingen"
)

// generateBinaryBytes is exposed to JavaScript.
// Takes project JSON string, returns an object with { bytes: Uint8Array, eventCount: number } or { error: string }
func generateBinaryBytes(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return map[string]interface{}{
			"error": "missing project JSON argument",
		}
	}

	projectJSON := args[0].String()
	result, err := bingen.GenerateFromJSON(projectJSON)
	if err != nil {
		return map[string]interface{}{
			"error": err.Error(),
		}
	}

	// Create a Uint8Array and copy the bytes into it
	uint8Array := js.Global().Get("Uint8Array").New(len(result.Bytes))
	js.CopyBytesToJS(uint8Array, result.Bytes)

	return map[string]interface{}{
		"bytes":      uint8Array,
		"eventCount": result.EventCount,
	}
}

// generateBinaryBase64 is an alternative that returns base64-encoded bytes.
// Useful for environments where Uint8Array handling is complex.
func generateBinaryBase64(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return map[string]interface{}{
			"error": "missing project JSON argument",
		}
	}

	projectJSON := args[0].String()
	result, err := bingen.GenerateFromJSON(projectJSON)
	if err != nil {
		return map[string]interface{}{
			"error": err.Error(),
		}
	}

	return map[string]interface{}{
		"base64":     base64.StdEncoding.EncodeToString(result.Bytes),
		"eventCount": result.EventCount,
	}
}

func main() {
	// Register functions on the global picolume namespace
	picolume := js.Global().Get("Object").New()
	picolume.Set("generateBinaryBytes", js.FuncOf(generateBinaryBytes))
	picolume.Set("generateBinaryBase64", js.FuncOf(generateBinaryBase64))
	js.Global().Set("picolume", picolume)

	// Keep the Go runtime alive
	select {}
}
