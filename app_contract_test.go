package main

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
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

func TestSaveProjectToPathWarnsOnAudioErrors(t *testing.T) {
	tempDir := t.TempDir()
	targetPath := filepath.Join(tempDir, "project.lum")

	app := &App{}
	result := app.SaveProjectToPath(targetPath, `{"name":"Test"}`, map[string]string{
		"good": "data:audio/wav;base64," + base64.StdEncoding.EncodeToString([]byte("RIFF")),
		"bad":  "not-a-data-url",
	})

	if result.Status != ResultStatusWarning {
		t.Fatalf("expected warning status, got %q", result.Status)
	}
	if result.Code != "saved_with_audio_errors" {
		t.Fatalf("expected saved_with_audio_errors code, got %q", result.Code)
	}
	if !strings.Contains(result.Message, "bad") {
		t.Fatalf("expected failing audio id in message, got %q", result.Message)
	}

	// The archive should still contain the project and the good audio file.
	reader, err := zip.OpenReader(targetPath)
	if err != nil {
		t.Fatalf("expected project archive to be readable: %v", err)
	}
	defer reader.Close()

	var foundGoodAudio bool
	for _, file := range reader.File {
		if file.Name == "audio/good.wav" {
			foundGoodAudio = true
		}
	}
	if !foundGoodAudio {
		t.Fatal("expected successfully encoded audio to be written")
	}
}

func TestBeforeClose(t *testing.T) {
	t.Run("allows close when not dirty", func(t *testing.T) {
		app := &App{
			messageDialogFn: func(_ context.Context, _ runtime.MessageDialogOptions) (string, error) {
				t.Fatal("dialog should not be shown when state is clean")
				return "", nil
			},
		}

		if prevent := app.beforeClose(context.Background()); prevent {
			t.Fatal("expected clean state to allow close")
		}
	})

	t.Run("prompts when dirty and respects answer", func(t *testing.T) {
		tests := []struct {
			answer      string
			wantPrevent bool
		}{
			{answer: "Yes", wantPrevent: false},
			{answer: "No", wantPrevent: true},
		}

		for _, tt := range tests {
			app := &App{
				messageDialogFn: func(_ context.Context, _ runtime.MessageDialogOptions) (string, error) {
					return tt.answer, nil
				},
			}
			app.SetDirty(true)

			if prevent := app.beforeClose(context.Background()); prevent != tt.wantPrevent {
				t.Fatalf("answer %q: expected prevent=%v, got %v", tt.answer, tt.wantPrevent, prevent)
			}
		}
	})

	t.Run("allows close if dialog fails", func(t *testing.T) {
		app := &App{
			messageDialogFn: func(_ context.Context, _ runtime.MessageDialogOptions) (string, error) {
				return "", errors.New("dialog unavailable")
			},
		}
		app.SetDirty(true)

		if prevent := app.beforeClose(context.Background()); prevent {
			t.Fatal("expected dialog failure to allow close rather than trap the user")
		}
	})
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

func TestSaveBinaryDataRejectsInvalidBase64(t *testing.T) {
	app := &App{}
	result := app.SaveBinaryData("%%%not-base64%%%")

	if result.Status != ResultStatusError {
		t.Fatalf("expected error status, got %q", result.Status)
	}
	if result.Code != "decode_failed" {
		t.Fatalf("expected decode_failed code, got %q", result.Code)
	}
	if !strings.Contains(result.Message, "Error decoding binary data") {
		t.Fatalf("expected decode error message, got %q", result.Message)
	}
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

func TestUploadToPicoReturnsStructuredErrors(t *testing.T) {
	t.Run("generate failure", func(t *testing.T) {
		app := &App{
			generateBinaryFn: func(string) ([]byte, int, error) {
				return nil, 0, errors.New("generator offline")
			},
			drives: mockDriveScanner{},
		}

		result := app.UploadToPico(`{"name":"demo"}`)

		if result.Status != ResultStatusError {
			t.Fatalf("expected error status, got %q", result.Status)
		}
		if result.Code != "generate_failed" {
			t.Fatalf("expected generate_failed code, got %q", result.Code)
		}
		if !strings.Contains(result.Message, "generator offline") {
			t.Fatalf("expected generator error in message, got %q", result.Message)
		}
	})

	t.Run("no drive found and chooser cancelled", func(t *testing.T) {
		app := &App{
			drives: mockDriveScanner{},
			generateBinaryFn: func(string) ([]byte, int, error) {
				return []byte{0x01}, 1, nil
			},
			openDirectoryDialogFn: func(_ context.Context, _ runtime.OpenDialogOptions) (string, error) {
				return "", nil
			},
		}

		result := app.UploadToPico(`{"name":"demo"}`)

		if result.Status != ResultStatusError {
			t.Fatalf("expected error status, got %q", result.Status)
		}
		if result.Code != "pico_not_found" {
			t.Fatalf("expected pico_not_found code, got %q", result.Code)
		}
	})

	t.Run("write failure", func(t *testing.T) {
		tempDir := t.TempDir()
		app := &App{
			drives: mockDriveScanner{drives: []DriveSearchResult{{Drive: tempDir, Mode: "USB"}}},
			generateBinaryFn: func(string) ([]byte, int, error) {
				return []byte{0x01}, 1, nil
			},
			writeBinaryFn: func(string, []byte) error {
				return errors.New("disk full")
			},
		}

		result := app.UploadToPico(`{"name":"demo"}`)

		if result.Status != ResultStatusError {
			t.Fatalf("expected error status, got %q", result.Status)
		}
		if result.Code != "write_failed" {
			t.Fatalf("expected write_failed code, got %q", result.Code)
		}
		if !strings.Contains(result.Message, "disk full") {
			t.Fatalf("expected disk error in message, got %q", result.Message)
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

func TestLoadProjectReturnsStructuredErrors(t *testing.T) {
	t.Run("file too large", func(t *testing.T) {
		tempDir := t.TempDir()
		projectPath := filepath.Join(tempDir, "too-large.lum")
		if err := os.WriteFile(projectPath, nil, 0644); err != nil {
			t.Fatalf("failed to create placeholder file: %v", err)
		}
		if err := os.Truncate(projectPath, MaxZipFileSize+1); err != nil {
			t.Fatalf("failed to resize placeholder file: %v", err)
		}

		app := &App{
			openFileDialogFn: func(_ context.Context, _ runtime.OpenDialogOptions) (string, error) {
				return projectPath, nil
			},
		}
		result := app.LoadProject()

		if result.Status != ResultStatusError {
			t.Fatalf("expected error status, got %q", result.Status)
		}
		if result.Code != "file_too_large" {
			t.Fatalf("expected file_too_large code, got %q", result.Code)
		}
	})

	t.Run("too many files in archive", func(t *testing.T) {
		tempDir := t.TempDir()
		projectPath := filepath.Join(tempDir, "too-many-files.lum")
		if err := writeZipWithFileCount(projectPath, MaxFilesInZip+1); err != nil {
			t.Fatalf("failed to create crowded archive: %v", err)
		}

		app := &App{
			openFileDialogFn: func(_ context.Context, _ runtime.OpenDialogOptions) (string, error) {
				return projectPath, nil
			},
		}
		result := app.LoadProject()

		if result.Status != ResultStatusError {
			t.Fatalf("expected error status, got %q", result.Status)
		}
		if result.Code != "too_many_files" {
			t.Fatalf("expected too_many_files code, got %q", result.Code)
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

func writeZipWithFileCount(path string, count int) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := zip.NewWriter(file)
	for i := 0; i < count; i++ {
		entry, err := writer.Create(fmt.Sprintf("entry_%03d.txt", i))
		if err != nil {
			return err
		}
		if _, err := entry.Write([]byte("x")); err != nil {
			return err
		}
	}

	return writer.Close()
}
