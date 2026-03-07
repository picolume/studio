package logger

import (
	"bytes"
	"errors"
	"log"
	"os"
	"strings"
	"sync"
	"testing"
)

func TestLevelString(t *testing.T) {
	tests := []struct {
		level Level
		want  string
	}{
		{DEBUG, "DEBUG"},
		{INFO, "INFO"},
		{WARN, "WARN"},
		{ERROR, "ERROR"},
		{Level(999), "UNKNOWN"},
	}

	for _, tt := range tests {
		if got := tt.level.String(); got != tt.want {
			t.Fatalf("Level(%d).String() = %q, want %q", tt.level, got, tt.want)
		}
	}
}

func TestGetDefaultLoggerProvidesFallback(t *testing.T) {
	resetLoggerTestState()
	t.Cleanup(resetLoggerTestState)

	logger := getDefaultLogger()
	if logger == nil {
		t.Fatal("expected fallback logger")
	}
	if logger.level != INFO {
		t.Fatalf("expected fallback logger level INFO, got %v", logger.level)
	}
}

func TestLoggerLogHonorsLevelAndWritesMessage(t *testing.T) {
	var buf bytes.Buffer
	logger := &Logger{
		level:  WARN,
		logger: log.New(&buf, "", 0),
	}

	logger.log(INFO, "skip me")
	logger.log(ERROR, "problem %d", 7)

	output := buf.String()
	if strings.Contains(output, "skip me") {
		t.Fatal("expected info message to be filtered out")
	}
	if !strings.Contains(output, "[ERROR]") || !strings.Contains(output, "problem 7") {
		t.Fatalf("expected formatted error log line, got %q", output)
	}
}

func TestInitCreatesLogFileAndHonorsSetLevel(t *testing.T) {
	resetLoggerTestState()
	t.Cleanup(func() {
		Close()
		resetLoggerTestState()
	})

	logDir := t.TempDir()
	if err := Init(logDir, WARN); err != nil {
		t.Fatalf("Init returned error: %v", err)
	}
	if defaultLogger == nil || defaultLogger.file == nil {
		t.Fatal("expected logger to open a log file")
	}

	logPath := defaultLogger.filePath
	Info("hidden")
	SetLevel(DEBUG)
	Debug("visible %d", 42)
	Close()

	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("failed to read log file: %v", err)
	}
	content := string(data)
	if strings.Contains(content, "hidden") {
		t.Fatal("expected info message to be filtered out at WARN level")
	}
	if !strings.Contains(content, "visible 42") {
		t.Fatalf("expected debug message in log file after SetLevel, got %q", content)
	}
}

func TestInitReturnsErrorForInvalidLogDirectory(t *testing.T) {
	resetLoggerTestState()
	t.Cleanup(resetLoggerTestState)

	filePath := t.TempDir() + string(os.PathSeparator) + "not-a-dir"
	if err := os.WriteFile(filePath, []byte("x"), 0644); err != nil {
		t.Fatalf("failed to create blocking file: %v", err)
	}

	if err := Init(filePath, INFO); err == nil {
		t.Fatal("expected Init to fail when logDir points to a file")
	}
}

func TestWithErrorAndWarnWithErrorUseDefaultLogger(t *testing.T) {
	resetLoggerTestState()
	t.Cleanup(resetLoggerTestState)

	var buf bytes.Buffer
	defaultLogger = &Logger{
		level:  DEBUG,
		logger: log.New(&buf, "", 0),
	}

	WithError(errors.New("boom"), "save %s", "failed")
	WarnWithError(errors.New("retry"), "upload %s", "warning")
	WithError(nil, "ignored")
	WarnWithError(nil, "ignored")

	output := buf.String()
	if !strings.Contains(output, "save failed: boom") {
		t.Fatalf("expected error output, got %q", output)
	}
	if !strings.Contains(output, "upload warning: retry") {
		t.Fatalf("expected warning output, got %q", output)
	}
}

func resetLoggerTestState() {
	if defaultLogger != nil && defaultLogger.file != nil {
		_ = defaultLogger.file.Close()
	}
	defaultLogger = nil
	once = sync.Once{}
	fallbackOnce = sync.Once{}
}
