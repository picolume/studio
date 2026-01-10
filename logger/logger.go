package logger

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

// Level represents log severity
type Level int

const (
	DEBUG Level = iota
	INFO
	WARN
	ERROR
)

func (l Level) String() string {
	switch l {
	case DEBUG:
		return "DEBUG"
	case INFO:
		return "INFO"
	case WARN:
		return "WARN"
	case ERROR:
		return "ERROR"
	default:
		return "UNKNOWN"
	}
}

// Logger provides structured logging with levels
type Logger struct {
	mu       sync.Mutex
	level    Level
	logger   *log.Logger
	file     *os.File
	filePath string
}

var (
	defaultLogger *Logger
	once          sync.Once
)

// Init initializes the default logger with optional file output
func Init(logDir string, minLevel Level) error {
	var initErr error
	once.Do(func() {
		defaultLogger = &Logger{
			level:  minLevel,
			logger: log.New(os.Stdout, "", 0),
		}

		if logDir != "" {
			if err := os.MkdirAll(logDir, 0755); err != nil {
				initErr = fmt.Errorf("failed to create log directory: %w", err)
				return
			}

			logFileName := fmt.Sprintf("picolume_%s.log", time.Now().Format("2006-01-02"))
			logPath := filepath.Join(logDir, logFileName)

			f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
			if err != nil {
				initErr = fmt.Errorf("failed to open log file: %w", err)
				return
			}

			defaultLogger.file = f
			defaultLogger.filePath = logPath
			defaultLogger.logger = log.New(f, "", 0)
		}
	})
	return initErr
}

// Close closes the log file if one is open
func Close() {
	if defaultLogger != nil && defaultLogger.file != nil {
		defaultLogger.file.Close()
	}
}

// SetLevel sets the minimum log level
func SetLevel(level Level) {
	if defaultLogger != nil {
		defaultLogger.mu.Lock()
		defaultLogger.level = level
		defaultLogger.mu.Unlock()
	}
}

func getDefaultLogger() *Logger {
	if defaultLogger == nil {
		defaultLogger = &Logger{
			level:  INFO,
			logger: log.New(os.Stdout, "", 0),
		}
	}
	return defaultLogger
}

func (l *Logger) log(level Level, format string, args ...interface{}) {
	if level < l.level {
		return
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	message := fmt.Sprintf(format, args...)

	// Get caller info (skip 3 frames: log, public func, caller)
	_, file, line, ok := runtime.Caller(3)
	caller := "unknown"
	if ok {
		caller = fmt.Sprintf("%s:%d", filepath.Base(file), line)
	}

	logLine := fmt.Sprintf("[%s] [%s] [%s] %s", timestamp, level, caller, message)
	l.logger.Println(logLine)

	// Also print to stdout if logging to file
	if l.file != nil {
		fmt.Println(logLine)
	}
}

// Debug logs a debug message
func Debug(format string, args ...interface{}) {
	getDefaultLogger().log(DEBUG, format, args...)
}

// Info logs an info message
func Info(format string, args ...interface{}) {
	getDefaultLogger().log(INFO, format, args...)
}

// Warn logs a warning message
func Warn(format string, args ...interface{}) {
	getDefaultLogger().log(WARN, format, args...)
}

// Error logs an error message
func Error(format string, args ...interface{}) {
	getDefaultLogger().log(ERROR, format, args...)
}

// WithError logs an error with the error object
func WithError(err error, format string, args ...interface{}) {
	if err == nil {
		return
	}
	message := fmt.Sprintf(format, args...)
	getDefaultLogger().log(ERROR, "%s: %v", message, err)
}

// WarnWithError logs a warning with the error object
func WarnWithError(err error, format string, args ...interface{}) {
	if err == nil {
		return
	}
	message := fmt.Sprintf(format, args...)
	getDefaultLogger().log(WARN, "%s: %v", message, err)
}
