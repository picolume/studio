package main

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"strings"

	"PicoLume/bingen"
	"PicoLume/logger"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.bug.st/serial"
)

// App struct
type App struct {
	ctx                   context.Context
	portEnum              PortEnumerator
	portOpener            PortOpener
	drives                DriveScanner
	saveFileDialogFn      func(context.Context, runtime.SaveDialogOptions) (string, error)
	openFileDialogFn      func(context.Context, runtime.OpenDialogOptions) (string, error)
	openDirectoryDialogFn func(context.Context, runtime.OpenDialogOptions) (string, error)
	generateBinaryFn      func(string) ([]byte, int, error)
	writeBinaryFn         func(string, []byte) error
	serialResetFn         func(string, PortEnumerator, PortOpener, func(string), func(string, string)) SerialResetResult
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		portEnum:              realPortEnumerator{},
		portOpener:            realPortOpener{},
		drives:                realDriveScanner{},
		saveFileDialogFn:      runtime.SaveFileDialog,
		openFileDialogFn:      runtime.OpenFileDialog,
		openDirectoryDialogFn: runtime.OpenDirectoryDialog,
		generateBinaryFn:      generateBinaryBytes,
		writeBinaryFn:         writeBinaryToUSBDrive,
		serialResetFn:         trySerialReset,
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) saveFileDialog(options runtime.SaveDialogOptions) (string, error) {
	if a != nil && a.saveFileDialogFn != nil {
		return a.saveFileDialogFn(a.ctx, options)
	}
	return runtime.SaveFileDialog(a.ctx, options)
}

func (a *App) openFileDialog(options runtime.OpenDialogOptions) (string, error) {
	if a != nil && a.openFileDialogFn != nil {
		return a.openFileDialogFn(a.ctx, options)
	}
	return runtime.OpenFileDialog(a.ctx, options)
}

func (a *App) openDirectoryDialog(options runtime.OpenDialogOptions) (string, error) {
	if a != nil && a.openDirectoryDialogFn != nil {
		return a.openDirectoryDialogFn(a.ctx, options)
	}
	return runtime.OpenDirectoryDialog(a.ctx, options)
}

func (a *App) generateBinary(projectJSON string) ([]byte, int, error) {
	if a != nil && a.generateBinaryFn != nil {
		return a.generateBinaryFn(projectJSON)
	}
	return generateBinaryBytes(projectJSON)
}

func (a *App) writeBinary(targetDrive string, data []byte) error {
	if a != nil && a.writeBinaryFn != nil {
		return a.writeBinaryFn(targetDrive, data)
	}
	return writeBinaryToUSBDrive(targetDrive, data)
}

func (a *App) serialReset(targetDrive string) SerialResetResult {
	if a != nil && a.serialResetFn != nil {
		return a.serialResetFn(targetDrive, a.portEnum, a.portOpener, a.emitUploadStatus, a.emitUploadManualEject)
	}
	return trySerialReset(targetDrive, a.portEnum, a.portOpener, a.emitUploadStatus, a.emitUploadManualEject)
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

func (a *App) SaveProjectToPath(path string, projectJson string, audioFiles map[string]string) OperationResult {
	// Validate and sanitize path to prevent directory traversal
	safePath, err := validateSavePath(path, []string{".lum"})
	if err != nil {
		return errorResult("invalid_path", "Error: Invalid path - "+err.Error())
	}

	outFile, err := os.Create(safePath)
	if err != nil {
		return errorResult("create_failed", "Error creating file: "+err.Error())
	}
	defer outFile.Close()

	zipWriter := zip.NewWriter(outFile)
	defer zipWriter.Close()

	f, err := zipWriter.Create("project.json")
	if err != nil {
		return errorResult("zip_entry_failed", "Error writing project.json: "+err.Error())
	}
	_, err = f.Write([]byte(projectJson))
	if err != nil {
		return errorResult("write_failed", "Error writing JSON data: "+err.Error())
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

		ext := audioExtForMime(mime)

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

	return okResult("saved", "Saved")
}

// SaveBinaryData saves pre-generated binary data (base64 encoded) using native file dialog.
// Binary generation is now handled in JavaScript for consistency.
func (a *App) SaveBinaryData(base64Data string) OperationResult {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return errorResult("decode_failed", "Error decoding binary data: "+err.Error())
	}

	filename, err := a.saveFileDialog(runtime.SaveDialogOptions{
		DefaultFilename: "show.bin",
		Title:           "Export Show Binary",
		Filters: []runtime.FileFilter{
			{DisplayName: "Binary Files (*.bin)", Pattern: "*.bin"},
		},
	})

	if err != nil || filename == "" {
		return cancelledResult("cancelled", "Cancelled")
	}

	err = os.WriteFile(filename, data, 0644)
	if err != nil {
		return errorResult("save_failed", "Error saving file: "+err.Error())
	}

	return okResult("saved", "OK")
}

// UploadToPico: Writes file and resets via Native Serial
func (a *App) UploadToPico(projectJson string) OperationResult {
	// 1. Generate binary
	a.emitUploadStatus("Generating show.bin...")
	data, count, err := a.generateBinary(projectJson)
	if err != nil {
		return errorResult("generate_failed", "Error generating binary: "+err.Error())
	}

	// 2. Find USB drive
	a.emitUploadStatus("Looking for PicoLume USB drive...")
	var possibleDrives []string
	for _, result := range a.drives.FindPicoUSBDrives() {
		if result.Mode == "USB" {
			possibleDrives = append(possibleDrives, result.Drive)
		}
	}

	if len(possibleDrives) == 0 {
		a.emitUploadStatus("Select the PicoLume USB drive...")
		dir, derr := a.openDirectoryDialog(runtime.OpenDialogOptions{
			Title: "Select PicoLume USB Drive (USB MODE)",
		})
		if derr != nil || dir == "" {
			return errorResult("pico_not_found", "No Pico found. (Hold CONFIG btn while plugging in?)")
		}
		possibleDrives = append(possibleDrives, dir)
	}

	targetDrive := possibleDrives[len(possibleDrives)-1]

	// 3. Write binary to drive
	a.emitUploadStatus(fmt.Sprintf("Uploading show.bin to %s...", targetDrive))
	if err := a.writeBinary(targetDrive, data); err != nil {
		return errorResult("write_failed", err.Error())
	}

	// 4. Attempt serial reset
	result := a.serialReset(targetDrive)
	if result.Success {
		return okResult("uploaded", fmt.Sprintf("Success! Uploaded %d events. Device is reloading.", count))
	}

	// 5. Handle reset failure
	if result.LockedPort != "" {
		a.emitUploadManualEject(targetDrive, fmt.Sprintf("PORT_LOCKED:%s", result.LockedPort))
	} else {
		a.emitUploadManualEject(targetDrive, "RESET_FAILED")
	}
	a.emitUploadStatus("Auto-reset failed; please safely eject the drive before unplugging.")
	return warningResult("manual_eject_required", fmt.Sprintf("Success! Uploaded %d events to %s. Manual eject required.", count, targetDrive))
}

type PicoConnectionStatus struct {
	Connected        bool   `json:"connected"`
	Mode             string `json:"mode"`             // "USB", "BOOTLOADER", "SERIAL", "USB+SERIAL", "NONE"
	USBDrive         string `json:"usbDrive"`         // e.g. "E:/"
	SerialPort       string `json:"serialPort"`       // e.g. "COM5"
	SerialPortLocked bool   `json:"serialPortLocked"` // true if port is held by another application
}

// GetPicoConnectionStatus provides lightweight device presence info for the status bar.
func (a *App) GetPicoConnectionStatus() PicoConnectionStatus {
	status := PicoConnectionStatus{
		Connected:  false,
		Mode:       "NONE",
		USBDrive:   "",
		SerialPort: "",
	}

	// USB drive scan.
	if drives := a.drives.FindPicoUSBDrives(); len(drives) > 0 {
		first := drives[0]
		status.USBDrive = first.Drive
		status.Mode = first.Mode
		status.Connected = true
	}

	// Serial port scan (for reset + normal run mode).
	if ports, err := a.portEnum.GetDetailedPortsList(); err == nil {
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
			s, err := a.portOpener.Open(port.Name, mode)
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

func (a *App) LoadProject() LoadResponse {
	filename, err := a.openFileDialog(runtime.OpenDialogOptions{
		Title: "Open Project",
		Filters: []runtime.FileFilter{
			{DisplayName: "PicoLume Project (*.lum)", Pattern: "*.lum"},
		},
	})

	if err != nil || filename == "" {
		return newLoadResponse(ResultStatusCancelled, "cancelled", "Load cancelled")
	}

	// Security: Check zip file size before opening
	fileInfo, err := os.Stat(filename)
	if err != nil {
		return newLoadResponse(ResultStatusError, "stat_failed", "Failed to stat file: "+err.Error())
	}
	if fileInfo.Size() > MaxZipFileSize {
		return newLoadResponse(ResultStatusError, "file_too_large", fmt.Sprintf("Project file too large (max %dMB)", MaxZipFileSize/(1024*1024)))
	}

	r, err := zip.OpenReader(filename)
	if err != nil {
		return newLoadResponse(ResultStatusError, "zip_open_failed", "Failed to open zip: "+err.Error())
	}
	defer r.Close()

	// Security: Check file count to prevent zip bombs
	if len(r.File) > MaxFilesInZip {
		return newLoadResponse(ResultStatusError, "too_many_files", fmt.Sprintf("Too many files in archive (max %d)", MaxFilesInZip))
	}

	response := LoadResponse{
		Status:     ResultStatusOK,
		Code:       "loaded",
		Message:    "Loaded",
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
			return newLoadResponse(ResultStatusError, "project_too_large", fmt.Sprintf("project.json too large (max %dMB)", MaxProjectJsonSize/(1024*1024)))
		}
		if isAudioFile && uncompressedSize > MaxAudioFileSize {
			return newLoadResponse(ResultStatusError, "audio_too_large", fmt.Sprintf("Audio file too large (max %dMB)", MaxAudioFileSize/(1024*1024)))
		}

		// Security: Check total extracted size
		if totalExtracted+uncompressedSize > MaxTotalExtractedSize {
			return newLoadResponse(ResultStatusError, "extract_limit_exceeded", fmt.Sprintf("Total extracted size exceeds limit (max %dMB)", MaxTotalExtractedSize/(1024*1024)))
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
			return newLoadResponse(ResultStatusError, "extract_limit_exceeded", "File exceeded size limit during extraction")
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

			mime := mimeForAudioExt(ext)

			b64 := base64.StdEncoding.EncodeToString(content)
			response.AudioFiles[id] = fmt.Sprintf("data:%s;base64,%s", mime, b64)
			logger.Debug("LoadProject: Loaded audio file %s (%d bytes)", id, len(content))
		}
	}

	logger.Info("LoadProject: Successfully loaded project with %d audio files from %s", len(response.AudioFiles), filename)
	return response
}
