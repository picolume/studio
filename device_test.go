package main

import (
	"errors"
	"testing"

	"go.bug.st/serial"
	"go.bug.st/serial/enumerator"
)

// ==========================================================
// MOCKS
// ==========================================================

// mockDriveScanner returns a fixed set of drive results.
type mockDriveScanner struct {
	drives []DriveSearchResult
}

func (m mockDriveScanner) FindPicoUSBDrives() []DriveSearchResult {
	return m.drives
}

// mockPortEnumerator returns a fixed set of port details.
type mockPortEnumerator struct {
	ports []*enumerator.PortDetails
	err   error
}

func (m mockPortEnumerator) GetDetailedPortsList() ([]*enumerator.PortDetails, error) {
	return m.ports, m.err
}

// mockPortOpener returns a fixed SerialPort or error for each Open call.
type mockPortOpener struct {
	port SerialPort
	err  error
}

func (m mockPortOpener) Open(name string, mode *serial.Mode) (SerialPort, error) {
	return m.port, m.err
}

// mockSerialPort records calls and returns configured results.
type mockSerialPort struct {
	written  []byte
	writeErr error
	closed   bool
}

func (m *mockSerialPort) SetDTR(bool) error { return nil }
func (m *mockSerialPort) SetRTS(bool) error { return nil }
func (m *mockSerialPort) Write(p []byte) (int, error) {
	if m.writeErr != nil {
		return 0, m.writeErr
	}
	m.written = append(m.written, p...)
	return len(p), nil
}
func (m *mockSerialPort) Close() error {
	m.closed = true
	return nil
}

// ==========================================================
// isPicoLikeUSBSerialPort tests
// ==========================================================

func TestIsPicoLikeUSBSerialPort(t *testing.T) {
	tests := []struct {
		name     string
		port     *enumerator.PortDetails
		expected bool
	}{
		{
			name:     "nil port",
			port:     nil,
			expected: false,
		},
		{
			name:     "non-USB port",
			port:     &enumerator.PortDetails{Name: "COM1", IsUSB: false},
			expected: false,
		},
		{
			name:     "Raspberry Pi VID",
			port:     &enumerator.PortDetails{Name: "COM3", IsUSB: true, VID: "2E8A", PID: "000A"},
			expected: true,
		},
		{
			name:     "Adafruit VID",
			port:     &enumerator.PortDetails{Name: "COM4", IsUSB: true, VID: "239A", PID: "0001"},
			expected: true,
		},
		{
			name:     "SparkFun VID",
			port:     &enumerator.PortDetails{Name: "COM5", IsUSB: true, VID: "1B4F", PID: "0001"},
			expected: true,
		},
		{
			name:     "pid.codes VID",
			port:     &enumerator.PortDetails{Name: "COM6", IsUSB: true, VID: "1209", PID: "0001"},
			expected: true,
		},
		{
			name:     "unknown VID with Pico product string",
			port:     &enumerator.PortDetails{Name: "COM7", IsUSB: true, VID: "AAAA", Product: "Pico Board"},
			expected: true,
		},
		{
			name:     "unknown VID with PicoLume product string",
			port:     &enumerator.PortDetails{Name: "COM8", IsUSB: true, VID: "AAAA", Product: "PicoLume v2"},
			expected: true,
		},
		{
			name:     "unknown VID with unrelated product string",
			port:     &enumerator.PortDetails{Name: "COM9", IsUSB: true, VID: "AAAA", Product: "USB Modem"},
			expected: false,
		},
		{
			name:     "USB port with no VID or product",
			port:     &enumerator.PortDetails{Name: "COM10", IsUSB: true},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isPicoLikeUSBSerialPort(tt.port)
			if result != tt.expected {
				t.Errorf("isPicoLikeUSBSerialPort() = %v, want %v", result, tt.expected)
			}
		})
	}
}

// ==========================================================
// isKnownRP2040VID tests
// ==========================================================

func TestIsKnownRP2040VID(t *testing.T) {
	tests := []struct {
		name     string
		vid      string
		expected bool
	}{
		{"empty", "", false},
		{"Raspberry Pi bare", "2E8A", true},
		{"Raspberry Pi prefixed", "VID_2E8A", true},
		{"Adafruit", "239A", true},
		{"SparkFun", "1B4F", true},
		{"pid.codes", "1209", true},
		{"lowercase Raspberry Pi", "2e8a", true},
		{"unknown VID", "FFFF", false},
		{"whitespace", "  2E8A  ", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isKnownRP2040VID(tt.vid)
			if result != tt.expected {
				t.Errorf("isKnownRP2040VID(%q) = %v, want %v", tt.vid, result, tt.expected)
			}
		})
	}
}

// ==========================================================
// isPortLockedError tests
// ==========================================================

func TestIsPortLockedError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{"nil error", nil, false},
		{"Windows access denied", errors.New("Access is denied"), true},
		{"Windows access denied lowercase", errors.New("access is denied"), true},
		{"Windows cannot access file", errors.New("The process cannot access the file because it is being used by another process"), true},
		{"Linux resource busy", errors.New("device or resource busy"), true},
		{"Linux resource busy uppercase", errors.New("Device or Resource Busy"), true},
		{"macOS resource busy", errors.New("resource busy"), true},
		{"port in use", errors.New("port is in use"), true},
		{"generic serial error - not locked", errors.New("serial port not found"), false},
		{"timeout error - not locked", errors.New("operation timed out"), false},
		{"permission denied", errors.New("permission denied"), true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isPortLockedError(tt.err)
			if result != tt.expected {
				t.Errorf("isPortLockedError(%v) = %v, want %v", tt.err, result, tt.expected)
			}
		})
	}
}

// ==========================================================
// GetPicoConnectionStatus tests (with mocked dependencies)
// ==========================================================

func TestGetPicoConnectionStatus_NoDevices(t *testing.T) {
	app := &App{
		drives:     mockDriveScanner{drives: nil},
		portEnum:   mockPortEnumerator{ports: nil},
		portOpener: mockPortOpener{err: errors.New("no port")},
	}

	status := app.GetPicoConnectionStatus()

	if status.Connected {
		t.Error("expected Connected=false when no devices present")
	}
	if status.Mode != "NONE" {
		t.Errorf("expected Mode=NONE, got %q", status.Mode)
	}
	if status.USBDrive != "" {
		t.Errorf("expected empty USBDrive, got %q", status.USBDrive)
	}
	if status.SerialPort != "" {
		t.Errorf("expected empty SerialPort, got %q", status.SerialPort)
	}
}

func TestGetPicoConnectionStatus_USBOnly(t *testing.T) {
	app := &App{
		drives: mockDriveScanner{drives: []DriveSearchResult{
			{Drive: "E:/", Mode: "USB"},
		}},
		portEnum:   mockPortEnumerator{ports: nil},
		portOpener: mockPortOpener{err: errors.New("no port")},
	}

	status := app.GetPicoConnectionStatus()

	if !status.Connected {
		t.Error("expected Connected=true with USB drive")
	}
	if status.Mode != "USB" {
		t.Errorf("expected Mode=USB, got %q", status.Mode)
	}
	if status.USBDrive != "E:/" {
		t.Errorf("expected USBDrive=E:/, got %q", status.USBDrive)
	}
}

func TestGetPicoConnectionStatus_BootloaderMode(t *testing.T) {
	app := &App{
		drives: mockDriveScanner{drives: []DriveSearchResult{
			{Drive: "F:/", Mode: "BOOTLOADER"},
		}},
		portEnum:   mockPortEnumerator{ports: nil},
		portOpener: mockPortOpener{err: errors.New("no port")},
	}

	status := app.GetPicoConnectionStatus()

	if !status.Connected {
		t.Error("expected Connected=true with bootloader drive")
	}
	if status.Mode != "BOOTLOADER" {
		t.Errorf("expected Mode=BOOTLOADER, got %q", status.Mode)
	}
}

func TestGetPicoConnectionStatus_SerialOnly(t *testing.T) {
	mockPort := &mockSerialPort{}
	app := &App{
		drives: mockDriveScanner{drives: nil},
		portEnum: mockPortEnumerator{ports: []*enumerator.PortDetails{
			{Name: "COM5", IsUSB: true, VID: "2E8A", PID: "000A"},
		}},
		portOpener: mockPortOpener{port: mockPort},
	}

	status := app.GetPicoConnectionStatus()

	if !status.Connected {
		t.Error("expected Connected=true with serial port")
	}
	if status.Mode != "SERIAL" {
		t.Errorf("expected Mode=SERIAL, got %q", status.Mode)
	}
	if status.SerialPort != "COM5" {
		t.Errorf("expected SerialPort=COM5, got %q", status.SerialPort)
	}
	if status.SerialPortLocked {
		t.Error("expected SerialPortLocked=false when port opens successfully")
	}
	if !mockPort.closed {
		t.Error("expected port to be closed after probe")
	}
}

func TestGetPicoConnectionStatus_USBPlusSerial(t *testing.T) {
	mockPort := &mockSerialPort{}
	app := &App{
		drives: mockDriveScanner{drives: []DriveSearchResult{
			{Drive: "E:/", Mode: "USB"},
		}},
		portEnum: mockPortEnumerator{ports: []*enumerator.PortDetails{
			{Name: "COM5", IsUSB: true, VID: "2E8A", PID: "000A"},
		}},
		portOpener: mockPortOpener{port: mockPort},
	}

	status := app.GetPicoConnectionStatus()

	if !status.Connected {
		t.Error("expected Connected=true")
	}
	if status.Mode != "USB+SERIAL" {
		t.Errorf("expected Mode=USB+SERIAL, got %q", status.Mode)
	}
	if status.USBDrive != "E:/" {
		t.Errorf("expected USBDrive=E:/, got %q", status.USBDrive)
	}
	if status.SerialPort != "COM5" {
		t.Errorf("expected SerialPort=COM5, got %q", status.SerialPort)
	}
}

func TestGetPicoConnectionStatus_LockedPort(t *testing.T) {
	app := &App{
		drives: mockDriveScanner{drives: nil},
		portEnum: mockPortEnumerator{ports: []*enumerator.PortDetails{
			{Name: "COM5", IsUSB: true, VID: "2E8A", PID: "000A"},
		}},
		portOpener: mockPortOpener{err: errors.New("Access is denied")},
	}

	status := app.GetPicoConnectionStatus()

	if !status.Connected {
		t.Error("expected Connected=true (port is present even if locked)")
	}
	if status.Mode != "SERIAL" {
		t.Errorf("expected Mode=SERIAL, got %q", status.Mode)
	}
	if !status.SerialPortLocked {
		t.Error("expected SerialPortLocked=true when port open returns access denied")
	}
}

func TestGetPicoConnectionStatus_EnumeratorError(t *testing.T) {
	app := &App{
		drives: mockDriveScanner{drives: []DriveSearchResult{
			{Drive: "E:/", Mode: "USB"},
		}},
		portEnum:   mockPortEnumerator{err: errors.New("enumeration failed")},
		portOpener: mockPortOpener{err: errors.New("no port")},
	}

	status := app.GetPicoConnectionStatus()

	if !status.Connected {
		t.Error("expected Connected=true (USB drive still found)")
	}
	if status.Mode != "USB" {
		t.Errorf("expected Mode=USB (serial scan failed gracefully), got %q", status.Mode)
	}
	if status.SerialPort != "" {
		t.Errorf("expected empty SerialPort when enumeration fails, got %q", status.SerialPort)
	}
}

func TestGetPicoConnectionStatus_SkipsNonPicoPorts(t *testing.T) {
	mockPort := &mockSerialPort{}
	app := &App{
		drives: mockDriveScanner{drives: nil},
		portEnum: mockPortEnumerator{ports: []*enumerator.PortDetails{
			{Name: "COM1", IsUSB: false},                                    // not USB
			{Name: "COM2", IsUSB: true, VID: "FFFF", Product: "USB Modem"}, // wrong VID
			{Name: "COM3", IsUSB: true, VID: "2E8A", PID: "000A"},          // Pico
		}},
		portOpener: mockPortOpener{port: mockPort},
	}

	status := app.GetPicoConnectionStatus()

	if status.SerialPort != "COM3" {
		t.Errorf("expected SerialPort=COM3 (first Pico port), got %q", status.SerialPort)
	}
}

// ==========================================================
// trySerialReset tests (with mocked dependencies)
// ==========================================================

func TestTrySerialReset_NoPorts(t *testing.T) {
	var statusMessages []string
	statusFn := func(msg string) { statusMessages = append(statusMessages, msg) }
	manualEjectFn := func(drive, reason string) {}

	result := trySerialReset(
		"E:/",
		mockPortEnumerator{ports: nil},
		mockPortOpener{err: errors.New("no port")},
		statusFn,
		manualEjectFn,
	)

	if result.Success {
		t.Error("expected Success=false when no ports found")
	}
	if result.LockedPort != "" {
		t.Errorf("expected empty LockedPort, got %q", result.LockedPort)
	}
}

func TestTrySerialReset_EnumeratorError(t *testing.T) {
	statusFn := func(msg string) {}
	manualEjectFn := func(drive, reason string) {}

	result := trySerialReset(
		"E:/",
		mockPortEnumerator{err: errors.New("enumeration failed")},
		mockPortOpener{err: errors.New("no port")},
		statusFn,
		manualEjectFn,
	)

	if result.Success {
		t.Error("expected Success=false when enumeration fails")
	}
}

func TestTrySerialReset_NoPicoPorts(t *testing.T) {
	statusFn := func(msg string) {}
	manualEjectFn := func(drive, reason string) {}

	result := trySerialReset(
		"E:/",
		mockPortEnumerator{ports: []*enumerator.PortDetails{
			{Name: "COM1", IsUSB: false},
			{Name: "COM2", IsUSB: true, VID: "FFFF", Product: "USB Modem"},
		}},
		mockPortOpener{err: errors.New("no port")},
		statusFn,
		manualEjectFn,
	)

	if result.Success {
		t.Error("expected Success=false when no Pico ports found")
	}
}

func TestTrySerialReset_PortLocked(t *testing.T) {
	statusFn := func(msg string) {}
	manualEjectFn := func(drive, reason string) {}

	result := trySerialReset(
		"E:/",
		mockPortEnumerator{ports: []*enumerator.PortDetails{
			{Name: "COM5", IsUSB: true, VID: "2E8A", PID: "000A"},
		}},
		mockPortOpener{err: errors.New("Access is denied")},
		statusFn,
		manualEjectFn,
	)

	if result.Success {
		t.Error("expected Success=false when port is locked")
	}
	if result.LockedPort != "COM5" {
		t.Errorf("expected LockedPort=COM5, got %q", result.LockedPort)
	}
}

func TestTrySerialReset_Success(t *testing.T) {
	mockPort := &mockSerialPort{}
	var statusMessages []string
	statusFn := func(msg string) { statusMessages = append(statusMessages, msg) }
	manualEjectFn := func(drive, reason string) {}

	result := trySerialReset(
		"E:/",
		mockPortEnumerator{ports: []*enumerator.PortDetails{
			{Name: "COM5", IsUSB: true, VID: "2E8A", PID: "000A"},
		}},
		mockPortOpener{port: mockPort},
		statusFn,
		manualEjectFn,
	)

	if !result.Success {
		t.Error("expected Success=true when port opens and write succeeds")
	}
	if !mockPort.closed {
		t.Error("expected port to be closed after reset")
	}
	// Verify the reset command was written.
	if string(mockPort.written) != "r\n" {
		t.Errorf("expected written data %q, got %q", "r\n", string(mockPort.written))
	}
	if len(statusMessages) == 0 {
		t.Error("expected status messages to be emitted")
	}
}

func TestTrySerialReset_WriteError(t *testing.T) {
	mockPort := &mockSerialPort{writeErr: errors.New("write failed")}
	statusFn := func(msg string) {}
	manualEjectFn := func(drive, reason string) {}

	result := trySerialReset(
		"E:/",
		mockPortEnumerator{ports: []*enumerator.PortDetails{
			{Name: "COM5", IsUSB: true, VID: "2E8A", PID: "000A"},
		}},
		mockPortOpener{port: mockPort},
		statusFn,
		manualEjectFn,
	)

	// Write failure should exhaust retries and return failure.
	if result.Success {
		t.Error("expected Success=false when all writes fail")
	}
}
