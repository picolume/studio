//go:build !windows

package main

// findPicoUSBDrives is a stub for non-Windows platforms.
// Future: implement Linux/macOS USB drive detection.
func findPicoUSBDrives() []DriveSearchResult {
	return nil
}
