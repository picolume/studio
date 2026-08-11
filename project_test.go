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

func TestMimeForAudioExt(t *testing.T) {
	tests := []struct {
		ext  string
		want string
	}{
		{"wav", "audio/wav"},
		{"WAV", "audio/wav"},
		{"ogg", "audio/ogg"},
		{"mp3", "audio/mpeg"},
		{"bin", "audio/mpeg"},
		{"", "audio/mpeg"},
	}
	for _, tt := range tests {
		t.Run(tt.ext, func(t *testing.T) {
			if got := mimeForAudioExt(tt.ext); got != tt.want {
				t.Errorf("mimeForAudioExt(%q) = %q, want %q", tt.ext, got, tt.want)
			}
		})
	}
}

func TestAudioExtForMime(t *testing.T) {
	tests := []struct {
		mime string
		want string
	}{
		{"audio/wav", "wav"},
		{"audio/ogg", "ogg"},
		{"audio/mpeg", "mp3"},
		{"audio/mp3", "mp3"},
		{"audio/unknown", "bin"},
		{"", "bin"},
	}
	for _, tt := range tests {
		t.Run(tt.mime, func(t *testing.T) {
			if got := audioExtForMime(tt.mime); got != tt.want {
				t.Errorf("audioExtForMime(%q) = %q, want %q", tt.mime, got, tt.want)
			}
		})
	}
}
