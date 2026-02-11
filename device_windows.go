//go:build windows

package main

import "os"

// findPicoUSBDrives scans Windows drive letters for PicoLume/RP2040 USB volumes.
func findPicoUSBDrives() []DriveSearchResult {
	var results []DriveSearchResult
	for _, drive := range "CDEFGHIJKLMNOPQRSTUVWXYZ" {
		driveRoot := string(drive) + ":/"
		if _, err := os.Stat(driveRoot); err != nil {
			continue
		}

		// Bootloader mode is exposed as a UF2 volume.
		if _, err := os.Stat(driveRoot + "INFO_UF2.TXT"); err == nil {
			results = append(results, DriveSearchResult{Drive: driveRoot, Mode: "BOOTLOADER"})
			continue
		}

		// Receiver USB upload volume (identified by INDEX.HTM or show.bin marker).
		if _, err := os.Stat(driveRoot + "INDEX.HTM"); err == nil {
			results = append(results, DriveSearchResult{Drive: driveRoot, Mode: "USB"})
			continue
		}
		if _, err := os.Stat(driveRoot + "show.bin"); err == nil {
			results = append(results, DriveSearchResult{Drive: driveRoot, Mode: "USB"})
			continue
		}
	}
	return results
}
