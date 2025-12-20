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

// ==========================================================
// DATA STRUCTURES
// ==========================================================

type Project struct {
	Settings   Settings    `json:"settings"`
	PropGroups []PropGroup `json:"propGroups"`
	Tracks     []Track     `json:"tracks"`
}

type Settings struct {
	LedCount   uint16            `json:"ledCount"`
	Brightness uint8             `json:"brightness"`
	Profiles   []HardwareProfile `json:"profiles"`
	Patch      map[string]string `json:"patch"`
}

type HardwareProfile struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	LedCount int    `json:"ledCount"`
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
	Color      string `json:"color"`
	Color2     string `json:"color2"`
	ColorA     string `json:"colorA"`
	ColorB     string `json:"colorB"`
	ColorStart string `json:"colorStart"`
}

// ==========================================================
// HELPER: CORE BINARY GENERATION (V2 with LUT)
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
	profileMap := make(map[string]int)
	if p.Settings.Profiles != nil {
		for _, prof := range p.Settings.Profiles {
			profileMap[prof.ID] = prof.LedCount
		}
	}

	defaultLen := int(p.Settings.LedCount)
	if defaultLen == 0 {
		defaultLen = 164
	}

	// --- 2. GENERATE LOOK-UP TABLE (LUT) ---
	lutBuf := new(bytes.Buffer)
	for i := 1; i <= TOTAL_PROPS; i++ {
		propID := strconv.Itoa(i)
		length := defaultLen

		if p.Settings.Patch != nil {
			if profileID, ok := p.Settings.Patch[propID]; ok {
				if val, found := profileMap[profileID]; found {
					length = val
				}
			}
		}

		binary.Write(lutBuf, binary.LittleEndian, uint16(length))
	}

	// --- 3. HELPERS FOR EVENTS ---
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

	// --- 4. GENERATE EVENTS ---
	buf := new(bytes.Buffer)
	eventBuf := new(bytes.Buffer)
	eventCount := 0

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

		for _, clip := range track.Clips {
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

			binary.Write(eventBuf, binary.LittleEndian, uint32(clip.StartTime))
			binary.Write(eventBuf, binary.LittleEndian, uint32(clip.Duration))
			binary.Write(eventBuf, binary.LittleEndian, uint8(getEffectCode(clip.Type)))
			eventBuf.Write([]byte{0, 0, 0})
			binary.Write(eventBuf, binary.LittleEndian, uint32(parseColor(colorHex)))
			binary.Write(eventBuf, binary.LittleEndian, uint32(parseColor(color2Hex)))
			for _, m := range mask {
				binary.Write(eventBuf, binary.LittleEndian, m)
			}
		}
	}

	// --- 5. WRITE HEADER (V2) ---
	// FIXED: Must match Pico's ShowHeader struct (16 bytes total):
	//
	// struct __attribute__((packed)) ShowHeader {
	//     uint32_t magic;      // 4 bytes  - offset 0
	//     uint16_t version;    // 2 bytes  - offset 4
	//     uint16_t eventCount; // 2 bytes  - offset 6
	//     uint16_t ledCount;   // 2 bytes  - offset 8  (legacy/fallback for V1)
	//     uint8_t  brightness; // 1 byte   - offset 10
	//     uint8_t  _reserved1; // 1 byte   - offset 11
	//     uint8_t  reserved[4];// 4 bytes  - offset 12
	// };
	//
	// For V2, the Pico then reads:
	//   - 1 byte padding
	//   - 448 bytes LUT (224 props × 2 bytes each)
	//   - Events...

	binary.Write(buf, binary.LittleEndian, uint32(0x5049434F))           // Magic "PICO"
	binary.Write(buf, binary.LittleEndian, uint16(2))                    // Version 2
	binary.Write(buf, binary.LittleEndian, uint16(eventCount))           // Event count
	binary.Write(buf, binary.LittleEndian, uint16(defaultLen))           // ledCount (fallback/legacy)
	binary.Write(buf, binary.LittleEndian, uint8(p.Settings.Brightness)) // Brightness
	buf.Write([]byte{0})                                                 // _reserved1
	buf.Write([]byte{0, 0, 0, 0})                                        // reserved[4]

	// V2-specific: padding byte before LUT (as expected by Pico V2 parsing)
	buf.Write([]byte{0})
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

// UploadToPico: Writes file and resets via Native Serial
func (a *App) UploadToPico(projectJson string) string {
	data, count, err := generateBinaryBytes(projectJson)
	if err != nil {
		return "Error generating binary: " + err.Error()
	}

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
		return "No Pico found. (Hold CONFIG btn while plugging in?)"
	}

	targetDrive = possibleDrives[len(possibleDrives)-1]

	// --- UPDATED FILE WRITE LOGIC ---
	destPath := filepath.Join(targetDrive, "show.bin")

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

	// --- TRIGGER RESET ---
	ports, err := enumerator.GetDetailedPortsList()
	if err != nil {
		return "File saved to " + targetDrive + ", but Serial scan failed."
	}

	targetPort := ""
	for _, port := range ports {
		if port.IsUSB {
			vid := strings.ToUpper(port.VID)
			if strings.Contains(vid, "2E8A") || strings.Contains(vid, "239A") {
				targetPort = port.Name
				break
			}
		}
	}

	if targetPort == "" {
		return fmt.Sprintf("Success! Saved to %s. (Auto-reset skipped: No COM port)", targetDrive)
	}

	// 4. Wait for OS to finish background tasks before rebooting
	time.Sleep(3 * time.Second)

	mode := &serial.Mode{BaudRate: 115200}
	port, err := serial.Open(targetPort, mode)
	if err != nil {
		return fmt.Sprintf("Success! Saved to %s. (Reset failed: %s)", targetDrive, targetPort)
	}
	defer port.Close()

	_, err = port.Write([]byte("r"))
	if err != nil {
		return fmt.Sprintf("Success! Saved to %s. (Reset failed: Write error)", targetDrive)
	}

	return fmt.Sprintf("Success! Uploaded %d events to %s.", count, targetDrive)
}

type LoadResponse struct {
	ProjectJson string            `json:"projectJson"`
	AudioFiles  map[string]string `json:"audioFiles"`
	FilePath    string            `json:"filePath"`
	Error       string            `json:"error"`
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
