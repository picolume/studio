package main

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func TestSaveProjectToPathReturnsStructuredResult(t *testing.T) {
	tempDir := t.TempDir()
	targetPath := filepath.Join(tempDir, "project.lum")

	app := &App{}
	result := app.SaveProjectToPath(targetPath, `{"name":"Test Project","tracks":[]}`, map[string]string{
		"buffer1": "data:audio/wav;base64," + base64.StdEncoding.EncodeToString([]byte("RIFF")),
	})

	if result.Status != ResultStatusOK {
		t.Fatalf("expected ok status, got %q", result.Status)
	}
	if result.Code != "saved" {
		t.Fatalf("expected saved code, got %q", result.Code)
	}
	if result.Message != "Saved" {
		t.Fatalf("expected Saved message, got %q", result.Message)
	}

	reader, err := zip.OpenReader(targetPath)
	if err != nil {
		t.Fatalf("expected project archive to be readable: %v", err)
	}
	defer reader.Close()

	var foundProjectJSON bool
	var foundAudio bool
	for _, file := range reader.File {
		switch file.Name {
		case "project.json":
			foundProjectJSON = true
		case "audio/buffer1.wav":
			foundAudio = true
		}
	}

	if !foundProjectJSON {
		t.Fatal("expected project.json in saved archive")
	}
	if !foundAudio {
		t.Fatal("expected audio/buffer1.wav in saved archive")
	}
}

func TestSaveProjectToPathRejectsInvalidPath(t *testing.T) {
	app := &App{}
	result := app.SaveProjectToPath("relative.lum", `{}`, nil)

	if result.Status != ResultStatusError {
		t.Fatalf("expected error status, got %q", result.Status)
	}
	if result.Code != "invalid_path" {
		t.Fatalf("expected invalid_path code, got %q", result.Code)
	}
	if !strings.Contains(result.Message, "Invalid path") {
		t.Fatalf("expected invalid path message, got %q", result.Message)
	}
}

func TestSaveBinaryDataReturnsStructuredResults(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		tempDir := t.TempDir()
		targetPath := filepath.Join(tempDir, "show.bin")

		app := &App{
			saveFileDialogFn: func(_ context.Context, _ runtime.SaveDialogOptions) (string, error) {
				return targetPath, nil
			},
		}
		result := app.SaveBinaryData(base64.StdEncoding.EncodeToString([]byte{0x01, 0x02, 0x03}))

		if result.Status != ResultStatusOK {
			t.Fatalf("expected ok status, got %q", result.Status)
		}
		if result.Code != "saved" {
			t.Fatalf("expected saved code, got %q", result.Code)
		}

		data, err := os.ReadFile(targetPath)
		if err != nil {
			t.Fatalf("expected binary to be written: %v", err)
		}
		if string(data) != string([]byte{0x01, 0x02, 0x03}) {
			t.Fatalf("unexpected binary contents: %v", data)
		}
	})

	t.Run("cancelled", func(t *testing.T) {
		app := &App{
			saveFileDialogFn: func(_ context.Context, _ runtime.SaveDialogOptions) (string, error) {
				return "", nil
			},
		}
		result := app.SaveBinaryData(base64.StdEncoding.EncodeToString([]byte{0x01}))

		if result.Status != ResultStatusCancelled {
			t.Fatalf("expected cancelled status, got %q", result.Status)
		}
		if result.Code != "cancelled" {
			t.Fatalf("expected cancelled code, got %q", result.Code)
		}
	})
}

func TestUploadToPicoReturnsStructuredResults(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		tempDir := t.TempDir()
		var wroteDrive string
		var wroteData []byte

		app := &App{
			drives: mockDriveScanner{drives: []DriveSearchResult{{Drive: tempDir, Mode: "USB"}}},
			generateBinaryFn: func(string) ([]byte, int, error) {
				return []byte{0xAA, 0xBB}, 12, nil
			},
			writeBinaryFn: func(drive string, data []byte) error {
				wroteDrive = drive
				wroteData = append([]byte(nil), data...)
				return nil
			},
			serialResetFn: func(string, PortEnumerator, PortOpener, func(string), func(string, string)) SerialResetResult {
				return SerialResetResult{Success: true}
			},
		}

		result := app.UploadToPico(`{"name":"demo"}`)

		if result.Status != ResultStatusOK {
			t.Fatalf("expected ok status, got %q", result.Status)
		}
		if result.Code != "uploaded" {
			t.Fatalf("expected uploaded code, got %q", result.Code)
		}
		if wroteDrive != tempDir {
			t.Fatalf("expected binary to be written to %q, got %q", tempDir, wroteDrive)
		}
		if string(wroteData) != string([]byte{0xAA, 0xBB}) {
			t.Fatalf("unexpected uploaded bytes: %v", wroteData)
		}
	})

	t.Run("manual eject warning", func(t *testing.T) {
		tempDir := t.TempDir()

		app := &App{
			drives: mockDriveScanner{drives: []DriveSearchResult{{Drive: tempDir, Mode: "USB"}}},
			generateBinaryFn: func(string) ([]byte, int, error) {
				return []byte{0xCC}, 7, nil
			},
			writeBinaryFn: func(string, []byte) error {
				return nil
			},
			serialResetFn: func(string, PortEnumerator, PortOpener, func(string), func(string, string)) SerialResetResult {
				return SerialResetResult{}
			},
		}

		result := app.UploadToPico(`{"name":"demo"}`)

		if result.Status != ResultStatusWarning {
			t.Fatalf("expected warning status, got %q", result.Status)
		}
		if result.Code != "manual_eject_required" {
			t.Fatalf("expected manual_eject_required code, got %q", result.Code)
		}
		if !strings.Contains(result.Message, "Manual eject required") {
			t.Fatalf("expected manual eject message, got %q", result.Message)
		}
	})
}

func TestLoadProjectReturnsStructuredResults(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		tempDir := t.TempDir()
		projectPath := filepath.Join(tempDir, "loaded.lum")
		if err := writeTestLumArchive(projectPath, `{"name":"Loaded"}`, map[string][]byte{"audio/clip1.wav": []byte("RIFF")}); err != nil {
			t.Fatalf("failed to create test project: %v", err)
		}

		app := &App{
			openFileDialogFn: func(_ context.Context, _ runtime.OpenDialogOptions) (string, error) {
				return projectPath, nil
			},
		}
		result := app.LoadProject()

		if result.Status != ResultStatusOK {
			t.Fatalf("expected ok status, got %q", result.Status)
		}
		if result.Code != "loaded" {
			t.Fatalf("expected loaded code, got %q", result.Code)
		}
		if result.ProjectJson != `{"name":"Loaded"}` {
			t.Fatalf("unexpected project json: %q", result.ProjectJson)
		}
		if got := result.AudioFiles["clip1"]; !strings.HasPrefix(got, "data:audio/wav;base64,") {
			t.Fatalf("expected wav data URL, got %q", got)
		}
	})

	t.Run("cancelled", func(t *testing.T) {
		app := &App{
			openFileDialogFn: func(_ context.Context, _ runtime.OpenDialogOptions) (string, error) {
				return "", nil
			},
		}
		result := app.LoadProject()

		if result.Status != ResultStatusCancelled {
			t.Fatalf("expected cancelled status, got %q", result.Status)
		}
		if result.Code != "cancelled" {
			t.Fatalf("expected cancelled code, got %q", result.Code)
		}
	})
}

func writeTestLumArchive(path string, projectJSON string, files map[string][]byte) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := zip.NewWriter(file)

	projectFile, err := writer.Create("project.json")
	if err != nil {
		return err
	}
	if _, err := projectFile.Write([]byte(projectJSON)); err != nil {
		return err
	}

	for name, data := range files {
		entry, err := writer.Create(name)
		if err != nil {
			return err
		}
		if _, err := entry.Write(data); err != nil {
			return err
		}
	}

	return writer.Close()
}
