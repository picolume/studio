package main

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"PicoLume/bingen"
	"PicoLume/logger"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.bug.st/serial"
	"go.bug.st/serial/enumerator"
)

// ==========================================================
// PATH VALIDATION (Security)
// ==========================================================

var (
	ErrEmptyPath        = errors.New("path cannot be empty")
	ErrInvalidExtension = errors.New("invalid file extension")
	ErrPathTraversal    = errors.New("path contains invalid traversal sequences")
	ErrPathNotAbsolute  = errors.New("path must be absolute")
)

// ==========================================================
// FILE SIZE LIMITS (Security - DoS Prevention)
// ==========================================================

const (
	// MaxZipFileSize is the maximum allowed size for a .lum project file (500MB)
	MaxZipFileSize = 500 * 1024 * 1024

	// MaxProjectJsonSize is the maximum allowed size for project.json (10MB)
	MaxProjectJsonSize = 10 * 1024 * 1024

	// MaxAudioFileSize is the maximum allowed size for a single audio file (200MB)
	MaxAudioFileSize = 200 * 1024 * 1024

	// MaxTotalExtractedSize is the maximum total size of all extracted files (1GB)
	MaxTotalExtractedSize = 1024 * 1024 * 1024

	// MaxFilesInZip is the maximum number of files allowed in a zip archive
	MaxFilesInZip = 100
)

// validateSavePath validates a file path for safe write operations.
// It ensures the path is absolute, has the expected extension, and
// doesn't contain directory traversal sequences.
func validateSavePath(path string, allowedExtensions []string) (string, error) {
	if path == "" {
		return "", ErrEmptyPath
	}

	// Clean the path to resolve any . or .. components
	cleanPath := filepath.Clean(path)

	// Ensure path is absolute
	if !filepath.IsAbs(cleanPath) {
		return "", ErrPathNotAbsolute
	}

	// Check for traversal sequences that survived cleaning
	// (shouldn't happen after Clean, but defense in depth)
	if strings.Contains(cleanPath, "..") {
		return "", ErrPathTraversal
	}

	// Validate extension if restrictions provided
	if len(allowedExtensions) > 0 {
		ext := strings.ToLower(filepath.Ext(cleanPath))
		valid := false
		for _, allowed := range allowedExtensions {
			if ext == strings.ToLower(allowed) {
				valid = true
				break
			}
		}
		if !valid {
			return "", ErrInvalidExtension
		}
	}

	return cleanPath, nil
}

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) emitUploadStatus(message string) {
	if a == nil || a.ctx == nil || message == "" {
		return
	}
	runtime.EventsEmit(a.ctx, "upload:status", message)
}

type UploadManualEject struct {
	Drive  string `json:"drive"`  // e.g. "E:/"
	Reason string `json:"reason"` // human-readable reason why manual action is needed
}

func (a *App) emitUploadManualEject(drive, reason string) {
	if a == nil || a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "upload:manual-eject", UploadManualEject{
		Drive:  drive,
		Reason: reason,
	})
}

// ==========================================================
// BINARY GENERATION (uses shared bingen package)
// ==========================================================

// generateBinaryBytes wraps the shared bingen package for binary generation.
// This ensures consistency between the Go backend, WASM, and any other consumers.
func generateBinaryBytes(projectJSON string) ([]byte, int, error) {
	result, err := bingen.GenerateFromJSON(projectJSON)
	if err != nil {
		return nil, 0, err
	}
	return result.Bytes, result.EventCount, nil
}

// ==========================================================
// EXPOSED FUNCTIONS
// ==========================================================

func (a *App) RequestSavePath() string {
	filename, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: "myshow.lum",
		Title:           "Save Project",
		Filters: []runtime.FileFilter{
			{DisplayName: "PicoLume Project (*.lum)", Pattern: "*.lum"},
		},
	})

	if err != nil {
		return ""
	}
	return filename
}

func (a *App) SaveProjectToPath(path string, projectJson string, audioFiles map[string]string) string {
	// Validate and sanitize path to prevent directory traversal
	safePath, err := validateSavePath(path, []string{".lum"})
	if err != nil {
		return "Error: Invalid path - " + err.Error()
	}

	outFile, err := os.Create(safePath)
	if err != nil {
		return "Error creating file: " + err.Error()
	}
	defer outFile.Close()

	zipWriter := zip.NewWriter(outFile)
	defer zipWriter.Close()

	f, err := zipWriter.Create("project.json")
	if err != nil {
		return "Error writing project.json: " + err.Error()
	}
	_, err = f.Write([]byte(projectJson))
	if err != nil {
		return "Error writing JSON data: " + err.Error()
	}

	var audioErrors []string
	for id, dataUrl := range audioFiles {
		parts := strings.Split(dataUrl, ",")
		if len(parts) != 2 {
			logger.Warn("SaveProject: Malformed data URL for audio file %s (expected 2 parts, got %d)", id, len(parts))
			audioErrors = append(audioErrors, fmt.Sprintf("malformed data URL for %s", id))
			continue
		}

		// Parse MIME type safely
		mimeSection := parts[0]
		colonIdx := strings.Index(mimeSection, ":")
		if colonIdx == -1 || colonIdx >= len(mimeSection)-1 {
			logger.Warn("SaveProject: Invalid MIME format for audio file %s: %s", id, mimeSection)
			audioErrors = append(audioErrors, fmt.Sprintf("invalid MIME format for %s", id))
			continue
		}
		mime := mimeSection[colonIdx+1:]
		if semiIdx := strings.Index(mime, ";"); semiIdx != -1 {
			mime = mime[:semiIdx]
		}

		ext := "bin"
		if strings.Contains(mime, "mpeg") || strings.Contains(mime, "mp3") {
			ext = "mp3"
		} else if strings.Contains(mime, "wav") {
			ext = "wav"
		} else if strings.Contains(mime, "ogg") {
			ext = "ogg"
		}

		decoded, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			logger.Warn("SaveProject: Failed to decode base64 for audio file %s: %v", id, err)
			audioErrors = append(audioErrors, fmt.Sprintf("decode error for %s", id))
			continue
		}

		zipPath := fmt.Sprintf("audio/%s.%s", id, ext)
		f, err := zipWriter.Create(zipPath)
		if err != nil {
			logger.Warn("SaveProject: Failed to create zip entry for %s: %v", zipPath, err)
			audioErrors = append(audioErrors, fmt.Sprintf("zip error for %s", id))
			continue
		}
		if _, err := f.Write(decoded); err != nil {
			logger.Warn("SaveProject: Failed to write audio data for %s: %v", zipPath, err)
			audioErrors = append(audioErrors, fmt.Sprintf("write error for %s", id))
		}
	}

	if len(audioErrors) > 0 {
		logger.Warn("SaveProject: Completed with %d audio file errors", len(audioErrors))
	}

	return "Saved"
}

// SaveBinary is deprecated - use SaveBinaryData instead.
// Kept for backwards compatibility.
func (a *App) SaveBinary(projectJson string) string {
	data, count, err := generateBinaryBytes(projectJson)
	if err != nil {
		return "Error: " + err.Error()
	}

	filename, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: "show.bin",
		Title:           "Export Show Binary",
		Filters: []runtime.FileFilter{
			{DisplayName: "Binary Files (*.bin)", Pattern: "*.bin"},
		},
	})

	if err != nil || filename == "" {
		return "Export cancelled"
	}

	err = os.WriteFile(filename, data, 0644)
	if err != nil {
		return "Error saving file: " + err.Error()
	}

	return fmt.Sprintf("Success! Exported %d events to %s", count, filename)
}

// SaveBinaryData saves pre-generated binary data (base64 encoded) using native file dialog.
// Binary generation is now handled in JavaScript for consistency.
func (a *App) SaveBinaryData(base64Data string) string {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "Error decoding binary data: " + err.Error()
	}

	filename, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: "show.bin",
		Title:           "Export Show Binary",
		Filters: []runtime.FileFilter{
			{DisplayName: "Binary Files (*.bin)", Pattern: "*.bin"},
		},
	})

	if err != nil || filename == "" {
		return "Cancelled"
	}

	err = os.WriteFile(filename, data, 0644)
	if err != nil {
		return "Error saving file: " + err.Error()
	}

	return "OK"
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

// UploadToPico: Writes file and resets via Native Serial
func (a *App) UploadToPico(projectJson string) string {
	a.emitUploadStatus("Generating show.bin...")
	data, count, err := generateBinaryBytes(projectJson)
	if err != nil {
		return "Error generating binary: " + err.Error()
	}

	a.emitUploadStatus("Looking for PicoLume USB drive...")
	targetDrive := ""
	possibleDrives := []string{}

	for _, drive := range "DEFGHIJKLMNOPQRSTUVWXYZ" {
		driveRoot := string(drive) + ":/"
		if _, err := os.Stat(driveRoot); err == nil {

			// Skip Bootloader Mode
			if _, err := os.Stat(driveRoot + "INFO_UF2.TXT"); err == nil {
				continue
			}

			// Look for Pico-specific markers
			if _, err := os.Stat(driveRoot + "INDEX.HTM"); err == nil {
				possibleDrives = append(possibleDrives, driveRoot)
			} else if _, err := os.Stat(driveRoot + "show.bin"); err == nil {
				possibleDrives = append(possibleDrives, driveRoot)
			}
		}
	}

	if len(possibleDrives) == 0 {
		// If the Pico's USB volume is freshly formatted, it may not contain any marker
		// files yet (e.g., INDEX.HTM/show.bin). Fall back to asking the user to select
		// the mounted drive manually.
		a.emitUploadStatus("Select the PicoLume USB drive...")
		dir, derr := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
			Title: "Select PicoLume USB Drive (USB MODE)",
		})
		if derr != nil || dir == "" {
			return "No Pico found. (Hold CONFIG btn while plugging in?)"
		}
		possibleDrives = append(possibleDrives, dir)
	}

	targetDrive = possibleDrives[len(possibleDrives)-1]

	// --- UPDATED FILE WRITE LOGIC ---
	destPath := filepath.Join(targetDrive, "show.bin")
	a.emitUploadStatus(fmt.Sprintf("Uploading show.bin to %s...", targetDrive))

	// 1. Open with Truncate
	f, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0666)
	if err != nil {
		return fmt.Sprintf("Failed to open %s: %s", targetDrive, err.Error())
	}

	// 2. Write Data
	_, err = f.Write(data)
	if err != nil {
		f.Close()
		return fmt.Sprintf("Failed to write to %s: %s", targetDrive, err.Error())
	}

	// 3. Force Flush to Disk
	err = f.Sync()
	if err != nil {
		logger.Warn("UploadToPico: Sync to disk failed for %s: %v", destPath, err)
	}
	f.Close()

	// --- TRIGGER DEVICE RELOAD ---
	// Prefer serial reset (works even when Windows refuses to "eject" a non-removable MSC device).
	confirmDriveDropsAsync := func(driveRoot string, grace time.Duration) {
		if driveRoot == "" {
			return
		}
		go func() {
			deadline := time.Now().Add(grace)
			for time.Now().Before(deadline) {
				if _, err := os.Stat(driveRoot); err != nil {
					return
				}
				time.Sleep(250 * time.Millisecond)
			}
			a.emitUploadManualEject(driveRoot, "Device did not disconnect/reload automatically after the reset command.")
		}()
	}

	trySerialReset := func() error {
		a.emitUploadStatus("Scanning for PicoLume serial port (auto-reset)...")
		ports, err := enumerator.GetDetailedPortsList()
		if err != nil {
			return err
		}

		isCandidate := func(p *enumerator.PortDetails) bool {
			return isPicoLikeUSBSerialPort(p)
		}

		var candidates []*enumerator.PortDetails
		for _, p := range ports {
			if isCandidate(p) {
				candidates = append(candidates, p)
			}
		}

		if len(candidates) == 0 {
			return fmt.Errorf("no suitable USB serial ports found")
		}

		driveLetter := filepath.VolumeName(targetDrive)
		driveRoot := driveLetter + `\`

		const resetAttemptsPerPort = 3
		const resetAttemptDelay = 350 * time.Millisecond

		// Track if we encountered a port lock error for better messaging.
		var lockedPort string

		a.emitUploadStatus("Resetting PicoLume device via serial...")
		time.Sleep(350 * time.Millisecond)

		for _, candidate := range candidates {
			for attempt := 1; attempt <= resetAttemptsPerPort; attempt++ {
				a.emitUploadStatus(fmt.Sprintf("Resetting via %s (attempt %d/%d)...", candidate.Name, attempt, resetAttemptsPerPort))

				mode := &serial.Mode{BaudRate: 115200}
				s, err := serial.Open(candidate.Name, mode)
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

				// We successfully sent the reset command. Windows can be slow to drop the USB mount,
				// so treat the write as success and confirm disconnect asynchronously.
				confirmDriveDropsAsync(driveRoot, 20*time.Second)
				return nil
			}

			// If it didn't reboot, try the next candidate port.
		}

		// Provide specific error message if port was locked by another application.
		if lockedPort != "" {
			return fmt.Errorf("PORT_LOCKED:%s", lockedPort)
		}

		return fmt.Errorf("RESET_FAILED")
	}

	serialErr := trySerialReset()
	if serialErr == nil {
		return fmt.Sprintf("Success! Uploaded %d events. Device is reloading.", count)
	}

	// Pass structured error code to frontend for clean messaging.
	a.emitUploadManualEject(targetDrive, serialErr.Error())
	a.emitUploadStatus("Auto-reset failed; please safely eject the drive before unplugging.")
	return fmt.Sprintf("Success! Uploaded %d events to %s. Manual eject required.", count, targetDrive)
}

type LoadResponse struct {
	ProjectJson string            `json:"projectJson"`
	AudioFiles  map[string]string `json:"audioFiles"`
	FilePath    string            `json:"filePath"`
	Error       string            `json:"error"`
}

type PicoConnectionStatus struct {
	Connected        bool   `json:"connected"`
	Mode             string `json:"mode"`             // "USB", "BOOTLOADER", "SERIAL", "USB+SERIAL", "NONE"
	USBDrive         string `json:"usbDrive"`         // e.g. "E:/"
	SerialPort       string `json:"serialPort"`       // e.g. "COM5"
	SerialPortLocked bool   `json:"serialPortLocked"` // true if port is held by another application
}

func (a *App) LoadProject() LoadResponse {
	filename, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open Project",
		Filters: []runtime.FileFilter{
			{DisplayName: "PicoLume Project (*.lum)", Pattern: "*.lum"},
		},
	})

	if err != nil || filename == "" {
		return LoadResponse{Error: "Cancelled"}
	}

	// Security: Check zip file size before opening
	fileInfo, err := os.Stat(filename)
	if err != nil {
		return LoadResponse{Error: "Failed to stat file: " + err.Error()}
	}
	if fileInfo.Size() > MaxZipFileSize {
		return LoadResponse{Error: fmt.Sprintf("Project file too large (max %dMB)", MaxZipFileSize/(1024*1024))}
	}

	r, err := zip.OpenReader(filename)
	if err != nil {
		return LoadResponse{Error: "Failed to open zip: " + err.Error()}
	}
	defer r.Close()

	// Security: Check file count to prevent zip bombs
	if len(r.File) > MaxFilesInZip {
		return LoadResponse{Error: fmt.Sprintf("Too many files in archive (max %d)", MaxFilesInZip)}
	}

	response := LoadResponse{
		AudioFiles: make(map[string]string),
		FilePath:   filename,
	}

	var totalExtracted uint64 = 0

	for _, f := range r.File {
		// Security: Skip directories
		if f.FileInfo().IsDir() {
			continue
		}

		// Security: Check uncompressed size before reading
		uncompressedSize := f.UncompressedSize64
		isProjectJson := f.Name == "project.json"
		isAudioFile := strings.HasPrefix(f.Name, "audio/")

		// Apply appropriate size limits based on file type
		if isProjectJson && uncompressedSize > MaxProjectJsonSize {
			return LoadResponse{Error: fmt.Sprintf("project.json too large (max %dMB)", MaxProjectJsonSize/(1024*1024))}
		}
		if isAudioFile && uncompressedSize > MaxAudioFileSize {
			return LoadResponse{Error: fmt.Sprintf("Audio file too large (max %dMB)", MaxAudioFileSize/(1024*1024))}
		}

		// Security: Check total extracted size
		if totalExtracted+uncompressedSize > MaxTotalExtractedSize {
			return LoadResponse{Error: fmt.Sprintf("Total extracted size exceeds limit (max %dMB)", MaxTotalExtractedSize/(1024*1024))}
		}

		// Only process known file types
		if !isProjectJson && !isAudioFile {
			continue
		}

		rc, err := f.Open()
		if err != nil {
			logger.Warn("LoadProject: Failed to open zip entry %s: %v", f.Name, err)
			continue
		}

		// Security: Use LimitReader to enforce size limit during read
		var maxSize int64
		if isProjectJson {
			maxSize = MaxProjectJsonSize
		} else {
			maxSize = MaxAudioFileSize
		}
		limitedReader := io.LimitReader(rc, maxSize+1) // +1 to detect overflow

		content, err := io.ReadAll(limitedReader)
		rc.Close()

		if err != nil {
			logger.Warn("LoadProject: Failed to read zip entry %s: %v", f.Name, err)
			continue
		}

		// Security: Verify we didn't exceed the limit
		if int64(len(content)) > maxSize {
			return LoadResponse{Error: "File exceeded size limit during extraction"}
		}

		totalExtracted += uint64(len(content))

		if isProjectJson {
			response.ProjectJson = string(content)
			logger.Info("LoadProject: Loaded project.json (%d bytes)", len(content))
		} else if isAudioFile {
			nameParts := strings.Split(f.Name, "/")
			fileName := nameParts[len(nameParts)-1]
			fileParts := strings.Split(fileName, ".")
			if len(fileParts) < 2 {
				logger.Warn("LoadProject: Skipping malformed audio filename: %s", f.Name)
				continue
			}
			id := fileParts[0]
			ext := fileParts[len(fileParts)-1]

			mime := "audio/mpeg"
			if ext == "wav" {
				mime = "audio/wav"
			}
			if ext == "ogg" {
				mime = "audio/ogg"
			}

			b64 := base64.StdEncoding.EncodeToString(content)
			response.AudioFiles[id] = fmt.Sprintf("data:%s;base64,%s", mime, b64)
			logger.Debug("LoadProject: Loaded audio file %s (%d bytes)", id, len(content))
		}
	}

	logger.Info("LoadProject: Successfully loaded project with %d audio files from %s", len(response.AudioFiles), filename)
	return response
}

// GetPicoConnectionStatus provides lightweight device presence info for the status bar.
func (a *App) GetPicoConnectionStatus() PicoConnectionStatus {
	status := PicoConnectionStatus{
		Connected:  false,
		Mode:       "NONE",
		USBDrive:   "",
		SerialPort: "",
	}

	// USB drive scan (Windows-only path semantics, but Stat works elsewhere too if mounted).
	usbDrive := ""
	usbMode := ""
	for _, drive := range "CDEFGHIJKLMNOPQRSTUVWXYZ" {
		driveRoot := string(drive) + ":/"
		if _, err := os.Stat(driveRoot); err != nil {
			continue
		}

		// Bootloader mode is exposed as a UF2 volume.
		if _, err := os.Stat(driveRoot + "INFO_UF2.TXT"); err == nil {
			usbDrive = driveRoot
			usbMode = "BOOTLOADER"
			break
		}

		// Receiver USB upload volume.
		if _, err := os.Stat(driveRoot + "INDEX.HTM"); err == nil {
			usbDrive = driveRoot
			usbMode = "USB"
			break
		}
		if _, err := os.Stat(driveRoot + "show.bin"); err == nil {
			usbDrive = driveRoot
			usbMode = "USB"
			break
		}
	}

	if usbDrive != "" {
		status.USBDrive = usbDrive
		status.Mode = usbMode
		status.Connected = true
	}

	// Serial port scan (for reset + normal run mode).
	if ports, err := enumerator.GetDetailedPortsList(); err == nil {
		for _, port := range ports {
			if !isPicoLikeUSBSerialPort(port) {
				continue
			}
			status.SerialPort = port.Name
			status.Connected = true
			if status.Mode == "NONE" {
				status.Mode = "SERIAL"
			} else if status.Mode == "USB" {
				status.Mode = "USB+SERIAL"
			}

			// Check if the port is locked by another application.
			// Try a brief open to detect if another app (Arduino IDE, etc.) has the port.
			mode := &serial.Mode{BaudRate: 115200}
			s, err := serial.Open(port.Name, mode)
			if err != nil {
				if isPortLockedError(err) {
					status.SerialPortLocked = true
				}
			} else {
				_ = s.Close()
			}
			break
		}
	}

	return status
}
