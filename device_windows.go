//go:build windows

package main

import (
	"os"

	"golang.org/x/sys/windows"
)

// isRemovableDrive reports whether the drive root (e.g. "E:/") is a removable
// volume. The Pico presents as removable in both UF2 bootloader and USB modes;
// requiring this prevents fixed disks (like C:) from ever being treated as a
// device just because a show.bin or INDEX.HTM exists at their root.
func isRemovableDrive(root string) bool {
	p, err := windows.UTF16PtrFromString(root)
	if err != nil {
		return false
	}
	return windows.GetDriveType(p) == windows.DRIVE_REMOVABLE
}

// findPicoUSBDrives scans Windows drive letters for PicoLume/RP2040 USB volumes.
func findPicoUSBDrives() []DriveSearchResult {
	var results []DriveSearchResult
	for _, drive := range "DEFGHIJKLMNOPQRSTUVWXYZ" {
		driveRoot := string(drive) + ":/"
		if _, err := os.Stat(driveRoot); err != nil {
			continue
		}
		if !isRemovableDrive(driveRoot) {
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
