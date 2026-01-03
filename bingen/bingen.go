// Package bingen provides binary generation for PicoLume show.bin files.
// This package is used by both the Wails desktop app and the WASM module.
package bingen

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

const (
	TotalProps    = 224
	MaskArraySize = 7
)

// Project represents the show project data structure.
type Project struct {
	Settings   Settings    `json:"settings"`
	PropGroups []PropGroup `json:"propGroups"`
	Tracks     []Track     `json:"tracks"`
	Cues       []Cue       `json:"cues"`
}

// Cue represents a cue point for live resync.
type Cue struct {
	ID      string `json:"id"`      // "A", "B", "C", "D"
	TimeMs  *int   `json:"timeMs"`  // null or milliseconds
	Enabled bool   `json:"enabled"` // only write if enabled
}

// Settings holds project-level settings.
type Settings struct {
	LedCount     uint16            `json:"ledCount"`
	Brightness   uint8             `json:"brightness"`
	ShowDuration float64           `json:"showDuration"` // Total show length in ms
	Profiles     []HardwareProfile `json:"profiles"`
	Patch        map[string]string `json:"patch"`
}

// HardwareProfile defines LED hardware configuration.
type HardwareProfile struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	AssignedIds   string `json:"assignedIds"` // Prop ID range (e.g., "1-18" or "1,3,5")
	LedCount      int    `json:"ledCount"`
	LedType       int    `json:"ledType"`       // 0=WS2812B, 1=SK6812, etc.
	ColorOrder    int    `json:"colorOrder"`    // 0=GRB, 1=RGB, etc.
	BrightnessCap int    `json:"brightnessCap"` // 0-255
}

// PropGroup defines a group of prop IDs.
type PropGroup struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	IDs  string `json:"ids"`
}

// Track represents a timeline track.
type Track struct {
	Type    string `json:"type"`
	GroupId string `json:"groupId"`
	Clips   []Clip `json:"clips"`
}

// Clip represents an effect clip on a track.
type Clip struct {
	StartTime float64   `json:"startTime"`
	Duration  float64   `json:"duration"`
	Type      string    `json:"type"`
	Props     ClipProps `json:"props"`
}

// ClipProps holds effect-specific properties.
type ClipProps struct {
	Color      string  `json:"color"`
	Color2     string  `json:"color2"`
	ColorA     string  `json:"colorA"`
	ColorB     string  `json:"colorB"`
	ColorStart string  `json:"colorStart"`
	Speed      float64 `json:"speed"`
	Width      float64 `json:"width"`
}

// PropConfig represents per-prop configuration in show.bin (8 bytes).
type PropConfig struct {
	LedCount      uint16
	LedType       uint8
	ColorOrder    uint8
	BrightnessCap uint8
	Reserved      [3]uint8
}

// Result contains the generated binary and metadata.
type Result struct {
	Bytes      []byte
	EventCount int
}

// GenerateFromJSON generates show.bin bytes from project JSON string.
func GenerateFromJSON(projectJSON string) (*Result, error) {
	var p Project
	if err := json.Unmarshal([]byte(projectJSON), &p); err != nil {
		return nil, fmt.Errorf("failed to parse project JSON: %w", err)
	}
	return Generate(&p)
}

// Generate creates show.bin bytes from a Project struct.
func Generate(p *Project) (*Result, error) {
	// --- 1. PREPARE PROFILES ---
	profileMap := make(map[string]*HardwareProfile)
	if p.Settings.Profiles != nil {
		for i := range p.Settings.Profiles {
			prof := &p.Settings.Profiles[i]
			profileMap[prof.ID] = prof
		}
	}

	// --- 2. BUILD PROP-TO-PROFILE MAPPING ---
	propAssignment := make(map[int]*HardwareProfile)

	// Apply profile's AssignedIds
	for i := range p.Settings.Profiles {
		prof := &p.Settings.Profiles[i]
		if prof.AssignedIds != "" {
			for _, propID := range parseIDRange(prof.AssignedIds) {
				propAssignment[propID] = prof
			}
		}
	}

	// Apply Patch overrides
	if p.Settings.Patch != nil {
		for propIDStr, profileID := range p.Settings.Patch {
			propID, err := strconv.Atoi(propIDStr)
			if err == nil && propID >= 1 && propID <= TotalProps {
				if prof, found := profileMap[profileID]; found {
					propAssignment[propID] = prof
				}
			}
		}
	}

	// --- 3. GENERATE LOOK-UP TABLE (LUT) ---
	const defaultLedCount = 164
	const defaultBrightness = 255

	lutBuf := new(bytes.Buffer)
	for i := 1; i <= TotalProps; i++ {
		config := PropConfig{
			LedCount:      defaultLedCount,
			LedType:       0,
			ColorOrder:    0,
			BrightnessCap: defaultBrightness,
			Reserved:      [3]uint8{0, 0, 0},
		}

		if prof, found := propAssignment[i]; found {
			config.LedCount = uint16(prof.LedCount)
			config.LedType = uint8(prof.LedType)
			config.ColorOrder = uint8(prof.ColorOrder)
			config.BrightnessCap = uint8(prof.BrightnessCap)
		}

		binary.Write(lutBuf, binary.LittleEndian, config.LedCount)
		binary.Write(lutBuf, binary.LittleEndian, config.LedType)
		binary.Write(lutBuf, binary.LittleEndian, config.ColorOrder)
		binary.Write(lutBuf, binary.LittleEndian, config.BrightnessCap)
		binary.Write(lutBuf, binary.LittleEndian, config.Reserved)
	}

	// --- 4. GENERATE EVENTS ---
	eventBuf := new(bytes.Buffer)
	eventCount := 0

	showDuration := p.Settings.ShowDuration
	if showDuration <= 0 {
		showDuration = 60000
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
		if isMaskEmpty(mask) {
			continue
		}

		// Sort clips by start time
		clips := make([]Clip, len(track.Clips))
		copy(clips, track.Clips)
		sortClips(clips)

		var lastEndTime float64 = 0

		for _, clip := range clips {
			// Gap detection
			if clip.StartTime > lastEndTime {
				gapDuration := clip.StartTime - lastEndTime
				if gapDuration > 0 {
					eventCount++
					writeEvent(eventBuf, uint32(lastEndTime), uint32(gapDuration), 0, 0, 0, 0, 0, mask)
				}
			}

			// Write clip event
			eventCount++
			colorHex := clip.Props.Color
			if colorHex == "" {
				colorHex = clip.Props.ColorStart
			}
			if colorHex == "" {
				colorHex = "#FFFFFF"
			}

			color2Hex := clip.Props.Color2
			if color2Hex == "" && clip.Type == "alternate" {
				color2Hex = clip.Props.ColorB
				if clip.Props.ColorA != "" {
					colorHex = clip.Props.ColorA
				}
			}
			if color2Hex == "" {
				color2Hex = "#000000"
			}

			speedVal := clip.Props.Speed
			if speedVal <= 0 {
				speedVal = 1.0
			}
			speedByte := uint8(min(255, int(speedVal*50)))
			widthByte := uint8(clip.Props.Width * 255)

			writeEvent(eventBuf,
				uint32(clip.StartTime),
				uint32(clip.Duration),
				getEffectCode(clip.Type),
				speedByte, widthByte,
				parseColor(colorHex),
				parseColor(color2Hex),
				mask)

			clipEnd := clip.StartTime + clip.Duration
			if clipEnd > lastEndTime {
				lastEndTime = clipEnd
			}
		}

		// Final OFF event
		if lastEndTime < showDuration {
			finalGap := showDuration - lastEndTime
			if finalGap > 0 {
				eventCount++
				writeEvent(eventBuf, uint32(lastEndTime), uint32(finalGap), 0, 0, 0, 0, 0, mask)
			}
		}
	}

	// --- 5. WRITE HEADER ---
	buf := new(bytes.Buffer)
	binary.Write(buf, binary.LittleEndian, uint32(0x5049434F)) // Magic "PICO"
	binary.Write(buf, binary.LittleEndian, uint16(3))          // Version 3
	binary.Write(buf, binary.LittleEndian, uint16(eventCount))
	buf.Write([]byte{0, 0, 0, 0, 0, 0, 0, 0}) // reserved[8]

	// Write LUT and events
	buf.Write(lutBuf.Bytes())
	buf.Write(eventBuf.Bytes())

	// --- 6. APPEND CUE BLOCK (if cues exist) ---
	hasCues := false
	for _, cue := range p.Cues {
		if cue.Enabled && cue.TimeMs != nil {
			hasCues = true
			break
		}
	}

	if hasCues {
		// Magic "CUE1"
		buf.Write([]byte{0x43, 0x55, 0x45, 0x31})
		binary.Write(buf, binary.LittleEndian, uint16(1)) // Version
		binary.Write(buf, binary.LittleEndian, uint16(4)) // Count

		cueIds := []string{"A", "B", "C", "D"}
		for _, cueId := range cueIds {
			timeValue := uint32(0xFFFFFFFF)
			for _, cue := range p.Cues {
				if cue.ID == cueId && cue.Enabled && cue.TimeMs != nil {
					timeValue = uint32(*cue.TimeMs)
					break
				}
			}
			binary.Write(buf, binary.LittleEndian, timeValue)
		}
		buf.Write([]byte{0, 0, 0, 0, 0, 0, 0, 0}) // Reserved
	}

	return &Result{
		Bytes:      buf.Bytes(),
		EventCount: eventCount,
	}, nil
}

// Helper functions

func parseIDRange(idStr string) []int {
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
						if i >= 1 && i <= TotalProps {
							ids = append(ids, i)
						}
					}
				}
			}
		} else {
			id, err := strconv.Atoi(part)
			if err == nil && id >= 1 && id <= TotalProps {
				ids = append(ids, id)
			}
		}
	}
	return ids
}

func calculateMask(idStr string) [MaskArraySize]uint32 {
	var masks [MaskArraySize]uint32
	parts := strings.Split(idStr, ",")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.Contains(part, "-") {
			ranges := strings.Split(part, "-")
			if len(ranges) != 2 {
				continue
			}
			start, err := strconv.Atoi(strings.TrimSpace(ranges[0]))
			if err != nil {
				continue
			}
			end, err := strconv.Atoi(strings.TrimSpace(ranges[1]))
			if err != nil {
				continue
			}
			if start > end {
				continue
			}
			for i := start; i <= end; i++ {
				if i >= 1 && i <= TotalProps {
					idx := i - 1
					masks[idx/32] |= (1 << (idx % 32))
				}
			}
		} else {
			i, err := strconv.Atoi(part)
			if err != nil {
				continue
			}
			if i >= 1 && i <= TotalProps {
				idx := i - 1
				masks[idx/32] |= (1 << (idx % 32))
			}
		}
	}
	return masks
}

func isMaskEmpty(mask [MaskArraySize]uint32) bool {
	for _, m := range mask {
		if m != 0 {
			return false
		}
	}
	return true
}

func parseColor(hex string) uint32 {
	if len(hex) == 0 {
		return 0
	}
	hex = strings.TrimPrefix(hex, "#")
	val, err := strconv.ParseUint(hex, 16, 32)
	if err != nil {
		return 0
	}
	return uint32(val)
}

func getEffectCode(t string) uint8 {
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

func writeEvent(buf *bytes.Buffer, startTime, duration uint32, effectType, speedByte, widthByte uint8, color, color2 uint32, mask [MaskArraySize]uint32) {
	binary.Write(buf, binary.LittleEndian, startTime)
	binary.Write(buf, binary.LittleEndian, duration)
	binary.Write(buf, binary.LittleEndian, effectType)
	buf.Write([]byte{speedByte, widthByte, 0})
	binary.Write(buf, binary.LittleEndian, color)
	binary.Write(buf, binary.LittleEndian, color2)
	for _, m := range mask {
		binary.Write(buf, binary.LittleEndian, m)
	}
}

func sortClips(clips []Clip) {
	for i := 0; i < len(clips)-1; i++ {
		for j := 0; j < len(clips)-i-1; j++ {
			if clips[j].StartTime > clips[j+1].StartTime {
				clips[j], clips[j+1] = clips[j+1], clips[j]
			}
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
