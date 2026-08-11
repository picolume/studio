package main

import (
	"errors"
	"path/filepath"
	"strings"
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

const (
	ResultStatusOK        = "ok"
	ResultStatusWarning   = "warning"
	ResultStatusError     = "error"
	ResultStatusCancelled = "cancelled"
)

// OperationResult is the structured response type for backend actions that do
// not need to return additional payload data.
type OperationResult struct {
	Status  string `json:"status"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// LoadResponse is the return type for LoadProject.
type LoadResponse struct {
	Status      string            `json:"status"`
	Code        string            `json:"code"`
	Message     string            `json:"message"`
	ProjectJson string            `json:"projectJson"`
	AudioFiles  map[string]string `json:"audioFiles"`
	FilePath    string            `json:"filePath"`
}

func newOperationResult(status string, code string, message string) OperationResult {
	return OperationResult{
		Status:  status,
		Code:    code,
		Message: message,
	}
}

func okResult(code string, message string) OperationResult {
	return newOperationResult(ResultStatusOK, code, message)
}

func warningResult(code string, message string) OperationResult {
	return newOperationResult(ResultStatusWarning, code, message)
}

func errorResult(code string, message string) OperationResult {
	return newOperationResult(ResultStatusError, code, message)
}

func cancelledResult(code string, message string) OperationResult {
	return newOperationResult(ResultStatusCancelled, code, message)
}

func newLoadResponse(status string, code string, message string) LoadResponse {
	return LoadResponse{
		Status:  status,
		Code:    code,
		Message: message,
	}
}

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

// ==========================================================
// MIME / EXTENSION MAPPING (Audio files)
// ==========================================================

// mimeForAudioExt returns the MIME type for a known audio file extension.
func mimeForAudioExt(ext string) string {
	switch strings.ToLower(ext) {
	case "wav":
		return "audio/wav"
	case "ogg":
		return "audio/ogg"
	default:
		return "audio/mpeg"
	}
}

// audioExtForMime returns the file extension for a known audio MIME type.
func audioExtForMime(mime string) string {
	lower := strings.ToLower(mime)
	switch {
	case strings.Contains(lower, "wav"):
		return "wav"
	case strings.Contains(lower, "ogg"):
		return "ogg"
	case strings.Contains(lower, "mpeg"), strings.Contains(lower, "mp3"):
		return "mp3"
	default:
		return "bin"
	}
}
