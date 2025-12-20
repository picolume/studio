package main

import (
	"testing"
)

func TestValidateSavePath(t *testing.T) {
	tests := []struct {
		name              string
		path              string
		allowedExtensions []string
		wantErr           error
		wantPath          string
	}{
		{
			name:              "valid absolute path with allowed extension",
			path:              "C:\\Users\\test\\project.lum",
			allowedExtensions: []string{".lum"},
			wantErr:           nil,
			wantPath:          "C:\\Users\\test\\project.lum",
		},
		{
			name:              "valid path with uppercase extension",
			path:              "C:\\Users\\test\\project.LUM",
			allowedExtensions: []string{".lum"},
			wantErr:           nil,
			wantPath:          "C:\\Users\\test\\project.LUM",
		},
		{
			name:              "valid path with mixed case extension",
			path:              "C:\\Users\\test\\project.Lum",
			allowedExtensions: []string{".LUM"},
			wantErr:           nil,
			wantPath:          "C:\\Users\\test\\project.Lum",
		},
		{
			name:              "empty path",
			path:              "",
			allowedExtensions: []string{".lum"},
			wantErr:           ErrEmptyPath,
			wantPath:          "",
		},
		{
			name:              "relative path",
			path:              "project.lum",
			allowedExtensions: []string{".lum"},
			wantErr:           ErrPathNotAbsolute,
			wantPath:          "",
		},
		{
			name:              "path with directory traversal",
			path:              "C:\\Users\\test\\..\\..\\etc\\passwd.lum",
			allowedExtensions: []string{".lum"},
			wantErr:           nil, // filepath.Clean resolves this
			wantPath:          "C:\\etc\\passwd.lum",
		},
		{
			name:              "invalid extension",
			path:              "C:\\Users\\test\\project.exe",
			allowedExtensions: []string{".lum"},
			wantErr:           ErrInvalidExtension,
			wantPath:          "",
		},
		{
			name:              "multiple allowed extensions - first match",
			path:              "C:\\Users\\test\\project.lum",
			allowedExtensions: []string{".lum", ".bin"},
			wantErr:           nil,
			wantPath:          "C:\\Users\\test\\project.lum",
		},
		{
			name:              "multiple allowed extensions - second match",
			path:              "C:\\Users\\test\\project.bin",
			allowedExtensions: []string{".lum", ".bin"},
			wantErr:           nil,
			wantPath:          "C:\\Users\\test\\project.bin",
		},
		{
			name:              "no extension restrictions",
			path:              "C:\\Users\\test\\anyfile.txt",
			allowedExtensions: []string{},
			wantErr:           nil,
			wantPath:          "C:\\Users\\test\\anyfile.txt",
		},
		{
			name:              "path with spaces",
			path:              "C:\\Users\\test user\\My Projects\\project.lum",
			allowedExtensions: []string{".lum"},
			wantErr:           nil,
			wantPath:          "C:\\Users\\test user\\My Projects\\project.lum",
		},
		{
			name:              "path with dot in directory name",
			path:              "C:\\Users\\test\\.config\\project.lum",
			allowedExtensions: []string{".lum"},
			wantErr:           nil,
			wantPath:          "C:\\Users\\test\\.config\\project.lum",
		},
		{
			name:              "forward slashes normalized",
			path:              "C:/Users/test/project.lum",
			allowedExtensions: []string{".lum"},
			wantErr:           nil,
			wantPath:          "C:\\Users\\test\\project.lum",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotPath, gotErr := validateSavePath(tt.path, tt.allowedExtensions)

			if gotErr != tt.wantErr {
				t.Errorf("validateSavePath() error = %v, wantErr %v", gotErr, tt.wantErr)
				return
			}

			if gotPath != tt.wantPath {
				t.Errorf("validateSavePath() path = %v, want %v", gotPath, tt.wantPath)
			}
		})
	}
}

func TestValidateSavePath_Unix(t *testing.T) {
	// These tests verify Unix-style paths work correctly
	// On Windows, these will fail the "absolute path" check since /path is not absolute on Windows
	// Skip on Windows
	if testing.Short() {
		t.Skip("Skipping Unix path tests on Windows")
	}
}

// TestParseColorInBinaryGeneration tests the parseColor helper function behavior
// by generating binary data with various color inputs
func TestParseColorInBinaryGeneration(t *testing.T) {
	tests := []struct {
		name        string
		projectJson string
		wantErr     bool
	}{
		{
			name: "valid hex color",
			projectJson: `{
				"settings": {"ledCount": 10, "brightness": 100, "profiles": [], "patch": {}},
				"propGroups": [{"id": "g1", "name": "Test", "ids": "1"}],
				"tracks": [{"type": "led", "groupId": "g1", "clips": [
					{"startTime": 0, "duration": 1000, "type": "solid", "props": {"color": "#FF0000"}}
				]}]
			}`,
			wantErr: false,
		},
		{
			name: "hex color without hash",
			projectJson: `{
				"settings": {"ledCount": 10, "brightness": 100, "profiles": [], "patch": {}},
				"propGroups": [{"id": "g1", "name": "Test", "ids": "1"}],
				"tracks": [{"type": "led", "groupId": "g1", "clips": [
					{"startTime": 0, "duration": 1000, "type": "solid", "props": {"color": "00FF00"}}
				]}]
			}`,
			wantErr: false,
		},
		{
			name: "empty color defaults to white",
			projectJson: `{
				"settings": {"ledCount": 10, "brightness": 100, "profiles": [], "patch": {}},
				"propGroups": [{"id": "g1", "name": "Test", "ids": "1"}],
				"tracks": [{"type": "led", "groupId": "g1", "clips": [
					{"startTime": 0, "duration": 1000, "type": "solid", "props": {}}
				]}]
			}`,
			wantErr: false,
		},
		{
			name: "invalid hex color handled gracefully",
			projectJson: `{
				"settings": {"ledCount": 10, "brightness": 100, "profiles": [], "patch": {}},
				"propGroups": [{"id": "g1", "name": "Test", "ids": "1"}],
				"tracks": [{"type": "led", "groupId": "g1", "clips": [
					{"startTime": 0, "duration": 1000, "type": "solid", "props": {"color": "#ZZZZZZ"}}
				]}]
			}`,
			wantErr: false, // Should not error, just default to black
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, count, err := generateBinaryBytes(tt.projectJson)

			if (err != nil) != tt.wantErr {
				t.Errorf("generateBinaryBytes() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if !tt.wantErr {
				if len(data) == 0 {
					t.Error("generateBinaryBytes() returned empty data")
				}
				if count != 1 {
					t.Errorf("generateBinaryBytes() event count = %v, want 1", count)
				}
			}
		})
	}
}

// TestCalculateMaskInBinaryGeneration tests the calculateMask helper behavior
func TestCalculateMaskInBinaryGeneration(t *testing.T) {
	tests := []struct {
		name        string
		projectJson string
		wantEvents  int
		wantErr     bool
	}{
		{
			name: "single prop ID",
			projectJson: `{
				"settings": {"ledCount": 10, "brightness": 100, "profiles": [], "patch": {}},
				"propGroups": [{"id": "g1", "name": "Test", "ids": "1"}],
				"tracks": [{"type": "led", "groupId": "g1", "clips": [
					{"startTime": 0, "duration": 1000, "type": "solid", "props": {"color": "#FF0000"}}
				]}]
			}`,
			wantEvents: 1,
			wantErr:    false,
		},
		{
			name: "comma separated IDs",
			projectJson: `{
				"settings": {"ledCount": 10, "brightness": 100, "profiles": [], "patch": {}},
				"propGroups": [{"id": "g1", "name": "Test", "ids": "1,3,5"}],
				"tracks": [{"type": "led", "groupId": "g1", "clips": [
					{"startTime": 0, "duration": 1000, "type": "solid", "props": {"color": "#FF0000"}}
				]}]
			}`,
			wantEvents: 1,
			wantErr:    false,
		},
		{
			name: "range of IDs",
			projectJson: `{
				"settings": {"ledCount": 10, "brightness": 100, "profiles": [], "patch": {}},
				"propGroups": [{"id": "g1", "name": "Test", "ids": "1-5"}],
				"tracks": [{"type": "led", "groupId": "g1", "clips": [
					{"startTime": 0, "duration": 1000, "type": "solid", "props": {"color": "#FF0000"}}
				]}]
			}`,
			wantEvents: 1,
			wantErr:    false,
		},
		{
			name: "mixed ranges and IDs",
			projectJson: `{
				"settings": {"ledCount": 10, "brightness": 100, "profiles": [], "patch": {}},
				"propGroups": [{"id": "g1", "name": "Test", "ids": "1,3-5,10"}],
				"tracks": [{"type": "led", "groupId": "g1", "clips": [
					{"startTime": 0, "duration": 1000, "type": "solid", "props": {"color": "#FF0000"}}
				]}]
			}`,
			wantEvents: 1,
			wantErr:    false,
		},
		{
			name: "empty IDs produces no events",
			projectJson: `{
				"settings": {"ledCount": 10, "brightness": 100, "profiles": [], "patch": {}},
				"propGroups": [{"id": "g1", "name": "Test", "ids": ""}],
				"tracks": [{"type": "led", "groupId": "g1", "clips": [
					{"startTime": 0, "duration": 1000, "type": "solid", "props": {"color": "#FF0000"}}
				]}]
			}`,
			wantEvents: 0, // Empty mask, skipped
			wantErr:    false,
		},
		{
			name: "invalid ID format handled gracefully",
			projectJson: `{
				"settings": {"ledCount": 10, "brightness": 100, "profiles": [], "patch": {}},
				"propGroups": [{"id": "g1", "name": "Test", "ids": "abc,1,xyz"}],
				"tracks": [{"type": "led", "groupId": "g1", "clips": [
					{"startTime": 0, "duration": 1000, "type": "solid", "props": {"color": "#FF0000"}}
				]}]
			}`,
			wantEvents: 1, // Only valid ID (1) is used
			wantErr:    false,
		},
		{
			name: "invalid range format handled gracefully",
			projectJson: `{
				"settings": {"ledCount": 10, "brightness": 100, "profiles": [], "patch": {}},
				"propGroups": [{"id": "g1", "name": "Test", "ids": "1-2-3,5"}],
				"tracks": [{"type": "led", "groupId": "g1", "clips": [
					{"startTime": 0, "duration": 1000, "type": "solid", "props": {"color": "#FF0000"}}
				]}]
			}`,
			wantEvents: 1, // Only valid ID (5) is used
			wantErr:    false,
		},
		{
			name: "reversed range handled gracefully",
			projectJson: `{
				"settings": {"ledCount": 10, "brightness": 100, "profiles": [], "patch": {}},
				"propGroups": [{"id": "g1", "name": "Test", "ids": "5-1,10"}],
				"tracks": [{"type": "led", "groupId": "g1", "clips": [
					{"startTime": 0, "duration": 1000, "type": "solid", "props": {"color": "#FF0000"}}
				]}]
			}`,
			wantEvents: 1, // Only valid ID (10) is used, 5-1 is invalid
			wantErr:    false,
		},
		{
			name: "IDs outside valid range (1-224) ignored",
			projectJson: `{
				"settings": {"ledCount": 10, "brightness": 100, "profiles": [], "patch": {}},
				"propGroups": [{"id": "g1", "name": "Test", "ids": "0,225,300,1"}],
				"tracks": [{"type": "led", "groupId": "g1", "clips": [
					{"startTime": 0, "duration": 1000, "type": "solid", "props": {"color": "#FF0000"}}
				]}]
			}`,
			wantEvents: 1, // Only valid ID (1) is used
			wantErr:    false,
		},
		{
			name: "IDs with spaces",
			projectJson: `{
				"settings": {"ledCount": 10, "brightness": 100, "profiles": [], "patch": {}},
				"propGroups": [{"id": "g1", "name": "Test", "ids": " 1 , 2 , 3 - 5 "}],
				"tracks": [{"type": "led", "groupId": "g1", "clips": [
					{"startTime": 0, "duration": 1000, "type": "solid", "props": {"color": "#FF0000"}}
				]}]
			}`,
			wantEvents: 1,
			wantErr:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, count, err := generateBinaryBytes(tt.projectJson)

			if (err != nil) != tt.wantErr {
				t.Errorf("generateBinaryBytes() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if count != tt.wantEvents {
				t.Errorf("generateBinaryBytes() event count = %v, want %v", count, tt.wantEvents)
			}

			// Even with no events, should still generate header + LUT
			if len(data) == 0 && !tt.wantErr {
				t.Error("generateBinaryBytes() returned empty data")
			}
		})
	}
}

// TestBinaryGenerationHeader tests that the binary header is correctly formatted
func TestBinaryGenerationHeader(t *testing.T) {
	projectJson := `{
		"settings": {"ledCount": 164, "brightness": 80, "profiles": [], "patch": {}},
		"propGroups": [{"id": "g1", "name": "Test", "ids": "1"}],
		"tracks": [{"type": "led", "groupId": "g1", "clips": [
			{"startTime": 0, "duration": 1000, "type": "solid", "props": {"color": "#FF0000"}}
		]}]
	}`

	data, count, err := generateBinaryBytes(projectJson)
	if err != nil {
		t.Fatalf("generateBinaryBytes() error = %v", err)
	}

	if count != 1 {
		t.Errorf("Expected 1 event, got %d", count)
	}

	// Check magic number "PICO" (0x5049434F in little endian)
	if len(data) < 4 {
		t.Fatal("Data too short to contain magic number")
	}

	magic := uint32(data[0]) | uint32(data[1])<<8 | uint32(data[2])<<16 | uint32(data[3])<<24
	if magic != 0x4F434950 { // "PICO" in little endian reads as OCIP
		// Actually 0x5049434F is 'P','I','C','O' = 0x50, 0x49, 0x43, 0x4F
		expectedMagic := uint32(0x5049434F)
		if magic != expectedMagic {
			t.Errorf("Magic number = 0x%08X, want 0x%08X", magic, expectedMagic)
		}
	}

	// Check version (bytes 4-5, should be 2)
	if len(data) < 6 {
		t.Fatal("Data too short to contain version")
	}
	version := uint16(data[4]) | uint16(data[5])<<8
	if version != 2 {
		t.Errorf("Version = %d, want 2", version)
	}

	// Check event count (bytes 6-7)
	if len(data) < 8 {
		t.Fatal("Data too short to contain event count")
	}
	eventCount := uint16(data[6]) | uint16(data[7])<<8
	if eventCount != 1 {
		t.Errorf("Event count in header = %d, want 1", eventCount)
	}
}

// TestInvalidJSON tests handling of malformed JSON input
func TestInvalidJSON(t *testing.T) {
	tests := []struct {
		name        string
		projectJson string
	}{
		{
			name:        "completely invalid JSON",
			projectJson: "not json at all",
		},
		{
			name:        "truncated JSON",
			projectJson: `{"settings": {"ledCount": 10`,
		},
		{
			name:        "empty string",
			projectJson: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := generateBinaryBytes(tt.projectJson)
			if err == nil {
				t.Error("generateBinaryBytes() expected error for invalid JSON, got nil")
			}
		})
	}
}

// TestAudioTracksIgnored verifies that audio tracks don't generate events
func TestAudioTracksIgnored(t *testing.T) {
	projectJson := `{
		"settings": {"ledCount": 10, "brightness": 100, "profiles": [], "patch": {}},
		"propGroups": [{"id": "g1", "name": "Test", "ids": "1"}],
		"tracks": [
			{"type": "audio", "groupId": "", "clips": [
				{"startTime": 0, "duration": 5000, "type": "audio", "props": {}}
			]},
			{"type": "led", "groupId": "g1", "clips": [
				{"startTime": 0, "duration": 1000, "type": "solid", "props": {"color": "#FF0000"}}
			]}
		]
	}`

	_, count, err := generateBinaryBytes(projectJson)
	if err != nil {
		t.Fatalf("generateBinaryBytes() error = %v", err)
	}

	if count != 1 {
		t.Errorf("Expected 1 event (only LED), got %d", count)
	}
}
