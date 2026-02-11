package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"PicoLume/logger"

	"go.bug.st/serial"
	"go.bug.st/serial/enumerator"
)

// ==========================================================
// INTERFACES (for testability)
// ==========================================================

// PortEnumerator abstracts serial port discovery.
type PortEnumerator interface {
	GetDetailedPortsList() ([]*enumerator.PortDetails, error)
}

// PortOpener abstracts opening a serial port connection.
type PortOpener interface {
	Open(name string, mode *serial.Mode) (SerialPort, error)
}

// SerialPort abstracts a serial port connection.
type SerialPort interface {
	SetDTR(bool) error
	SetRTS(bool) error
	Write([]byte) (int, error)
	Close() error
}

// DriveScanner abstracts USB drive detection.
type DriveScanner interface {
	FindPicoUSBDrives() []DriveSearchResult
}

// --- Real implementations ---

type realPortEnumerator struct{}

func (realPortEnumerator) GetDetailedPortsList() ([]*enumerator.PortDetails, error) {
	return enumerator.GetDetailedPortsList()
}

type realPortOpener struct{}

func (realPortOpener) Open(name string, mode *serial.Mode) (SerialPort, error) {
	return serial.Open(name, mode)
}

type realDriveScanner struct{}

func (realDriveScanner) FindPicoUSBDrives() []DriveSearchResult {
	return findPicoUSBDrives()
}

// ==========================================================
// TYPES
// ==========================================================

// DriveSearchResult holds the result of scanning for a PicoLume USB drive.
type DriveSearchResult struct {
	Drive string // e.g. "E:/"
	Mode  string // "USB" or "BOOTLOADER"
}

func isKnownRP2040VID(vid string) bool {
	v := strings.ToUpper(strings.TrimSpace(vid))
	if v == "" {
		return false
	}
	// Match substring so we handle both "2E8A" and "VID_2E8A".
	return strings.Contains(v, "2E8A") || // Raspberry Pi
		strings.Contains(v, "239A") || // Adafruit
		strings.Contains(v, "1B4F") || // SparkFun
		strings.Contains(v, "1209") // pid.codes (open-source hardware community VID)
}

func isPicoLikeUSBSerialPort(p *enumerator.PortDetails) bool {
	if p == nil || !p.IsUSB {
		return false
	}
	if isKnownRP2040VID(p.VID) {
		return true
	}
	// Some environments omit VID/PID; fall back to product string if available.
	product := strings.ToUpper(p.Product)
	return strings.Contains(product, "PICO") || strings.Contains(product, "PICOLUME")
}

// isPortLockedError checks if a serial port error indicates the port is held by another application.
func isPortLockedError(err error) bool {
	if err == nil {
		return false
	}
	errStr := strings.ToLower(err.Error())
	// Windows: "Access is denied", "The process cannot access the file"
	// Linux/Mac: "resource busy", "device or resource busy"
	return strings.Contains(errStr, "access") ||
		strings.Contains(errStr, "denied") ||
		strings.Contains(errStr, "busy") ||
		strings.Contains(errStr, "in use") ||
		strings.Contains(errStr, "cannot access")
}

// writeBinaryToUSBDrive writes show.bin data to the target USB drive.
func writeBinaryToUSBDrive(driveRoot string, data []byte) error {
	destPath := filepath.Join(driveRoot, "show.bin")
	f, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0666)
	if err != nil {
		return fmt.Errorf("failed to open %s: %w", driveRoot, err)
	}

	if _, err = f.Write(data); err != nil {
		f.Close()
		return fmt.Errorf("failed to write to %s: %w", driveRoot, err)
	}

	if err = f.Sync(); err != nil {
		logger.Warn("writeBinaryToUSBDrive: Sync failed for %s: %v", destPath, err)
	}
	f.Close()
	return nil
}

// SerialResetResult describes the outcome of a serial reset attempt.
type SerialResetResult struct {
	Success    bool
	LockedPort string // non-empty if a port was locked by another application
}

// trySerialReset attempts to reset a PicoLume device via USB serial.
// targetDrive is the USB drive root used to confirm disconnection.
// portEnum and portOpener abstract hardware access for testability.
// statusFn is called with human-readable progress messages.
// manualEjectFn is called if the drive doesn't disconnect automatically.
func trySerialReset(targetDrive string, portEnum PortEnumerator, portOpener PortOpener, statusFn func(string), manualEjectFn func(string, string)) SerialResetResult {
	statusFn("Scanning for PicoLume serial port (auto-reset)...")
	ports, err := portEnum.GetDetailedPortsList()
	if err != nil {
		return SerialResetResult{}
	}

	var candidates []*enumerator.PortDetails
	for _, p := range ports {
		if isPicoLikeUSBSerialPort(p) {
			candidates = append(candidates, p)
		}
	}

	if len(candidates) == 0 {
		return SerialResetResult{}
	}

	driveLetter := filepath.VolumeName(targetDrive)
	driveRoot := driveLetter + `\`

	const resetAttemptsPerPort = 3
	const resetAttemptDelay = 350 * time.Millisecond

	var lockedPort string

	statusFn("Resetting PicoLume device via serial...")
	time.Sleep(350 * time.Millisecond)

	for _, candidate := range candidates {
		for attempt := 1; attempt <= resetAttemptsPerPort; attempt++ {
			statusFn(fmt.Sprintf("Resetting via %s (attempt %d/%d)...", candidate.Name, attempt, resetAttemptsPerPort))

			mode := &serial.Mode{BaudRate: 115200}
			s, err := portOpener.Open(candidate.Name, mode)
			if err != nil {
				if isPortLockedError(err) {
					lockedPort = candidate.Name
				}
				time.Sleep(resetAttemptDelay)
				continue
			}
			// Some USB CDC implementations only deliver data after DTR is asserted.
			// Ignore errors here (not all backends support toggling modem lines).
			_ = s.SetDTR(true)
			_ = s.SetRTS(true)
			time.Sleep(250 * time.Millisecond)

			_, werr := s.Write([]byte("r"))
			if werr == nil {
				_, _ = s.Write([]byte("\n"))
			}
			time.Sleep(250 * time.Millisecond)
			_ = s.Close()
			if werr != nil {
				time.Sleep(resetAttemptDelay)
				continue
			}

			// Successfully sent the reset command. Windows can be slow to drop
			// the USB mount, so confirm disconnect asynchronously.
			go confirmDriveDrops(driveRoot, 20*time.Second, manualEjectFn)
			return SerialResetResult{Success: true}
		}
	}

	if lockedPort != "" {
		return SerialResetResult{LockedPort: lockedPort}
	}
	return SerialResetResult{}
}

// confirmDriveDrops polls until the drive disappears or the grace period expires.
func confirmDriveDrops(driveRoot string, grace time.Duration, manualEjectFn func(string, string)) {
	if driveRoot == "" {
		return
	}
	deadline := time.Now().Add(grace)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(driveRoot); err != nil {
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
	manualEjectFn(driveRoot, "Device did not disconnect/reload automatically after the reset command.")
}
