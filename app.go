package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

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
// DATA STRUCTURES
// ==========================================================

type Project struct {
	Settings   Settings    `json:"settings"`
	PropGroups []PropGroup `json:"propGroups"`
	Tracks     []Track     `json:"tracks"`
}

type Settings struct {
	LedCount     uint16            `json:"ledCount"`
	Brightness   uint8             `json:"brightness"`
	ShowDuration float64           `json:"showDuration"` // Total show length in ms
	Profiles     []HardwareProfile `json:"profiles"`
	Patch        map[string]string `json:"patch"`
}

type HardwareProfile struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	AssignedIds string `json:"assignedIds"` // Prop ID range (e.g., "1-18" or "1,3,5")
	LedCount    int    `json:"ledCount"`

	// Firmware-critical fields (written to show.bin)
	LedType       int `json:"ledType"`       // 0=WS2812B, 1=SK6812, 2=SK6812_RGBW, 3=WS2811, 4=WS2813, 5=WS2815
	ColorOrder    int `json:"colorOrder"`    // 0=GRB, 1=RGB, 2=BRG, 3=RBG, 4=GBR, 5=BGR
	BrightnessCap int `json:"brightnessCap"` // 0-255, max brightness for this profile

	// Informational fields (not written to binary)
	Voltage        int    `json:"voltage"`        // 5, 12, or 24
	PhysicalLength *int   `json:"physicalLength"` // cm, nullable
	PixelsPerMeter int    `json:"pixelsPerMeter"` // LED density
	Notes          string `json:"notes"`          // User notes
}

// PropConfig represents the per-prop configuration written to show.bin (8 bytes)
// This matches the firmware's PropConfig struct
type PropConfig struct {
	LedCount      uint16 // Number of LEDs
	LedType       uint8  // LED chipset type
	ColorOrder    uint8  // Color channel ordering
	BrightnessCap uint8  // Max brightness (0-255)
	Reserved      [3]uint8
}

type PropGroup struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	IDs  string `json:"ids"`
}

type Track struct {
	Type    string `json:"type"`
	GroupId string `json:"groupId"`
	Clips   []Clip `json:"clips"`
}

type Clip struct {
	StartTime float64   `json:"startTime"`
	Duration  float64   `json:"duration"`
	Type      string    `json:"type"`
	Props     ClipProps `json:"props"`
}

type ClipProps struct {
	Color      string  `json:"color"`
	Color2     string  `json:"color2"`
	ColorA     string  `json:"colorA"`
	ColorB     string  `json:"colorB"`
	ColorStart string  `json:"colorStart"`
	Speed      float64 `json:"speed"`
	Width      float64 `json:"width"`
}

// ==========================================================
// HELPER: CORE BINARY GENERATION (V3 with PropConfig LUT)
// ==========================================================
func generateBinaryBytes(projectJson string) ([]byte, int, error) {
	var p Project
	err := json.Unmarshal([]byte(projectJson), &p)
	if err != nil {
		return nil, 0, err
	}

	const TOTAL_PROPS = 224
	const MASK_ARRAY_SIZE = 7

	// --- 1. PREPARE PROFILES ---
	// Map profile ID -> full profile data
	profileMap := make(map[string]*HardwareProfile)
	if p.Settings.Profiles != nil {
		for i := range p.Settings.Profiles {
			prof := &p.Settings.Profiles[i]
			profileMap[prof.ID] = prof
		}
	}

	// --- 2. BUILD PROP-TO-PROFILE MAPPING ---
	// Priority: profile.AssignedIds (parsed), then fall back to Patch map
	// propAssignment maps prop ID (int) -> profile pointer
	propAssignment := make(map[int]*HardwareProfile)

	// Helper to parse ID strings like "1-18" or "1,3,5" into individual prop IDs
	parseIdRange := func(idStr string) []int {
		var ids []int
		parts := strings.Split(idStr, ",")
		for _, part := range parts {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			if strings.Contains(part, "-") {
				rangeParts := strings.Split(part, "-")
				if len(rangeParts) == 2 {
					start, err1 := strconv.Atoi(strings.TrimSpace(rangeParts[0]))
					end, err2 := strconv.Atoi(strings.TrimSpace(rangeParts[1]))
					if err1 == nil && err2 == nil && start <= end {
						for i := start; i <= end; i++ {
							if i >= 1 && i <= TOTAL_PROPS {
								ids = append(ids, i)
							}
						}
					}
				}
			} else {
				id, err := strconv.Atoi(part)
				if err == nil && id >= 1 && id <= TOTAL_PROPS {
					ids = append(ids, id)
				}
			}
		}
		return ids
	}

	// First, apply profile's AssignedIds (later profiles override earlier ones)
	for i := range p.Settings.Profiles {
		prof := &p.Settings.Profiles[i]
		if prof.AssignedIds != "" {
			for _, propID := range parseIdRange(prof.AssignedIds) {
				propAssignment[propID] = prof
			}
		}
	}

	// Then, apply Patch map overrides (explicit assignments take priority)
	if p.Settings.Patch != nil {
		for propIDStr, profileID := range p.Settings.Patch {
			propID, err := strconv.Atoi(propIDStr)
			if err == nil && propID >= 1 && propID <= TOTAL_PROPS {
				if prof, found := profileMap[profileID]; found {
					propAssignment[propID] = prof
				}
			}
		}
	}

	// --- 3. GENERATE LOOK-UP TABLE (LUT) with PropConfig ---
	// V3 format: 8 bytes per prop (PropConfig struct)
	// Default values for props not assigned to any profile
	const defaultLedCount = 164
	const defaultBrightness = 255

	lutBuf := new(bytes.Buffer)
	for i := 1; i <= TOTAL_PROPS; i++ {
		// Default config values (used for unassigned props)
		config := PropConfig{
			LedCount:      defaultLedCount,
			LedType:       0, // WS2812B
			ColorOrder:    0, // GRB
			BrightnessCap: defaultBrightness,
			Reserved:      [3]uint8{0, 0, 0},
		}

		// Override with profile-specific values if assigned
		if prof, found := propAssignment[i]; found {
			config.LedCount = uint16(prof.LedCount)
			config.LedType = uint8(prof.LedType)
			config.ColorOrder = uint8(prof.ColorOrder)
			config.BrightnessCap = uint8(prof.BrightnessCap)
		}

		// Write PropConfig struct (8 bytes)
		binary.Write(lutBuf, binary.LittleEndian, config.LedCount)
		binary.Write(lutBuf, binary.LittleEndian, config.LedType)
		binary.Write(lutBuf, binary.LittleEndian, config.ColorOrder)
		binary.Write(lutBuf, binary.LittleEndian, config.BrightnessCap)
		binary.Write(lutBuf, binary.LittleEndian, config.Reserved)
	}

	// --- 4. HELPERS FOR EVENTS ---
	parseColor := func(hex string) uint32 {
		if len(hex) == 0 {
			return 0
		}
		hex = strings.TrimPrefix(hex, "#")
		val, err := strconv.ParseUint(hex, 16, 32)
		if err != nil {
			// Invalid hex color - log and default to black
			fmt.Printf("Warning: Invalid color hex '%s': %v\n", hex, err)
			return 0
		}
		return uint32(val)
	}

	getEffectCode := func(t string) uint8 {
		codes := map[string]uint8{
			"solid": 1, "flash": 2, "strobe": 3, "rainbow": 4, "rainbowHold": 5, "chase": 6,
			"wipe": 9, "scanner": 10, "meteor": 11, "fire": 12, "heartbeat": 13,
			"glitch": 14, "energy": 15, "sparkle": 16, "breathe": 17, "alternate": 18,
		}
		if val, ok := codes[t]; ok {
			return val
		}
		return 1
	}

	calculateMask := func(idStr string) [MASK_ARRAY_SIZE]uint32 {
		var masks [MASK_ARRAY_SIZE]uint32
		parts := strings.Split(idStr, ",")
		for _, part := range parts {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			if strings.Contains(part, "-") {
				ranges := strings.Split(part, "-")
				// Validate range format (must have exactly 2 parts)
				if len(ranges) != 2 {
					fmt.Printf("Warning: Invalid ID range format '%s' - expected 'start-end'\n", part)
					continue
				}
				start, err := strconv.Atoi(strings.TrimSpace(ranges[0]))
				if err != nil {
					fmt.Printf("Warning: Invalid range start '%s': %v\n", ranges[0], err)
					continue
				}
				end, err := strconv.Atoi(strings.TrimSpace(ranges[1]))
				if err != nil {
					fmt.Printf("Warning: Invalid range end '%s': %v\n", ranges[1], err)
					continue
				}
				// Validate range bounds
				if start > end {
					fmt.Printf("Warning: Invalid range '%s' - start > end\n", part)
					continue
				}
				for i := start; i <= end; i++ {
					if i >= 1 && i <= TOTAL_PROPS {
						idx := i - 1
						masks[idx/32] |= (1 << (idx % 32))
					}
				}
			} else {
				i, err := strconv.Atoi(part)
				if err != nil {
					fmt.Printf("Warning: Invalid prop ID '%s': %v\n", part, err)
					continue
				}
				if i >= 1 && i <= TOTAL_PROPS {
					idx := i - 1
					masks[idx/32] |= (1 << (idx % 32))
				}
			}
		}
		return masks
	}

	// --- 4. HELPER: Write an event to the buffer ---
	writeEvent := func(eventBuf *bytes.Buffer, startTime, duration uint32, effectType uint8,
		speedByte, widthByte uint8, color, color2 uint32, mask [MASK_ARRAY_SIZE]uint32) {
		binary.Write(eventBuf, binary.LittleEndian, startTime)
		binary.Write(eventBuf, binary.LittleEndian, duration)
		binary.Write(eventBuf, binary.LittleEndian, effectType)
		eventBuf.Write([]byte{speedByte, widthByte, 0}) // Speed, Width, Reserved
		binary.Write(eventBuf, binary.LittleEndian, color)
		binary.Write(eventBuf, binary.LittleEndian, color2)
		for _, m := range mask {
			binary.Write(eventBuf, binary.LittleEndian, m)
		}
	}

	// --- 5. GENERATE EVENTS (with gap-filling) ---
	buf := new(bytes.Buffer)
	eventBuf := new(bytes.Buffer)
	eventCount := 0

	// Get show duration for final OFF event (default to 60000ms if not set)
	showDuration := p.Settings.ShowDuration
	if showDuration <= 0 {
		showDuration = 60000 // Default 1 minute
	}

	for _, track := range p.Tracks {
		if track.Type != "led" {
			continue
		}
		var groupIds string
		for _, g := range p.PropGroups {
			if g.ID == track.GroupId {
				groupIds = g.IDs
				break
			}
		}
		mask := calculateMask(groupIds)
		isEmpty := true
		for _, m := range mask {
			if m != 0 {
				isEmpty = false
				break
			}
		}
		if isEmpty {
			continue
		}

		// Sort clips by start time for gap detection
		clips := make([]Clip, len(track.Clips))
		copy(clips, track.Clips)
		// Simple bubble sort (clips are usually few)
		for i := 0; i < len(clips)-1; i++ {
			for j := 0; j < len(clips)-i-1; j++ {
				if clips[j].StartTime > clips[j+1].StartTime {
					clips[j], clips[j+1] = clips[j+1], clips[j]
				}
			}
		}

		// Track the end of the last clip for gap detection
		var lastEndTime float64 = 0

		for _, clip := range clips {
			// --- GAP DETECTION: Insert OFF event if there's a gap before this clip ---
			if clip.StartTime > lastEndTime {
				gapDuration := clip.StartTime - lastEndTime
				if gapDuration > 0 {
					eventCount++
					writeEvent(eventBuf,
						uint32(lastEndTime), // Start at end of previous clip
						uint32(gapDuration), // Duration of the gap
						0,                   // Effect type 0 = OFF
						0, 0,                // Speed, Width (not used for OFF)
						0, 0, // Colors (not used for OFF)
						mask)
				}
			}

			// --- Write the actual clip event ---
			eventCount++
			colorHex := clip.Props.Color
			if colorHex == "" {
				colorHex = clip.Props.ColorStart
			}
			if colorHex == "" {
				colorHex = "#FFFFFF"
			}

			// Determine color2 based on effect type
			color2Hex := clip.Props.Color2
			if color2Hex == "" {
				// For alternate effect, use colorB as color2
				if clip.Type == "alternate" {
					color2Hex = clip.Props.ColorB
					// Also use colorA as primary color for alternate
					if clip.Props.ColorA != "" {
						colorHex = clip.Props.ColorA
					}
				}
			}
			if color2Hex == "" {
				color2Hex = "#000000"
			}

			// Calculate Speed/Width bytes
			// Speed: 0.1-5.0 mapped to 0-255 (x * 50). Default 1.0 -> 50.
			speedVal := clip.Props.Speed
			if speedVal <= 0 {
				speedVal = 1.0
			}
			speedByte := uint8(0)
			if speedVal*50 > 255 {
				speedByte = 255
			} else {
				speedByte = uint8(speedVal * 50)
			}

			// Width: 0.0-1.0 mapped to 0-255
			widthByte := uint8(clip.Props.Width * 255)

			writeEvent(eventBuf,
				uint32(clip.StartTime),
				uint32(clip.Duration),
				getEffectCode(clip.Type),
				speedByte, widthByte,
				parseColor(colorHex),
				parseColor(color2Hex),
				mask)

			// Update lastEndTime
			clipEnd := clip.StartTime + clip.Duration
			if clipEnd > lastEndTime {
				lastEndTime = clipEnd
			}
		}

		// --- FINAL OFF EVENT: From last clip end to show duration ---
		if lastEndTime < showDuration {
			finalGap := showDuration - lastEndTime
			if finalGap > 0 {
				eventCount++
				writeEvent(eventBuf,
					uint32(lastEndTime),
					uint32(finalGap),
					0, // OFF
					0, 0,
					0, 0,
					mask)
			}
		}
	}

	// --- 6. WRITE HEADER (V3) ---
	// ShowHeader struct (16 bytes total):
	//
	// struct __attribute__((packed)) ShowHeader {
	//     uint32_t magic;      // 4 bytes  - offset 0
	//     uint16_t version;    // 2 bytes  - offset 4
	//     uint16_t eventCount; // 2 bytes  - offset 6
	//     uint8_t  reserved[8];// 8 bytes  - offset 8 (reserved for future use)
	// };
	//
	// For V3, after header:
	//   - 1792 bytes PropConfig LUT (224 props × 8 bytes each)
	//   - Events...
	//
	// PropConfig struct (8 bytes per prop):
	//   uint16_t led_count;     // 2 bytes
	//   uint8_t  led_type;      // 1 byte (0=WS2812B, 1=SK6812, 2=SK6812_RGBW, 3=APA102, 4=WS2811, 5=WS2813, 6=WS2815)
	//   uint8_t  color_order;   // 1 byte (0=GRB, 1=RGB, 2=BRG, 3=RBG, 4=GBR, 5=BGR)
	//   uint8_t  brightness_cap;// 1 byte (0-255)
	//   uint8_t  reserved[3];   // 3 bytes

	binary.Write(buf, binary.LittleEndian, uint32(0x5049434F)) // Magic "PICO"
	binary.Write(buf, binary.LittleEndian, uint16(3))          // Version 3
	binary.Write(buf, binary.LittleEndian, uint16(eventCount)) // Event count
	buf.Write([]byte{0, 0, 0, 0, 0, 0, 0, 0})                  // reserved[8]

	// V3: PropConfig LUT follows header directly (1792 bytes = 224 × 8)
	buf.Write(lutBuf.Bytes())
	buf.Write(eventBuf.Bytes())

	return buf.Bytes(), eventCount, nil
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

	for id, dataUrl := range audioFiles {
		parts := strings.Split(dataUrl, ",")
		if len(parts) != 2 {
			continue
		}

		mime := strings.Split(parts[0], ":")[1]
		mime = strings.Split(mime, ";")[0]
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
			continue
		}

		zipPath := fmt.Sprintf("audio/%s.%s", id, ext)
		f, err := zipWriter.Create(zipPath)
		if err == nil {
			f.Write(decoded)
		}
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
		fmt.Println("Warning: Sync failed", err)
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
			continue
		}

		// Security: Verify we didn't exceed the limit
		if int64(len(content)) > maxSize {
			return LoadResponse{Error: "File exceeded size limit during extraction"}
		}

		totalExtracted += uint64(len(content))

		if isProjectJson {
			response.ProjectJson = string(content)
		} else if isAudioFile {
			nameParts := strings.Split(f.Name, "/")
			fileName := nameParts[len(nameParts)-1]
			fileParts := strings.Split(fileName, ".")
			if len(fileParts) < 2 {
				continue // Skip malformed filenames
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
		}
	}

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
