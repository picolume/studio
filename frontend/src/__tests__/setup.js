// Test setup file
// Mock Wails runtime for testing
global.window = global.window || {};
global.window.go = {
  main: {
    App: {
      SaveProjectToPath: vi.fn(),
      RequestSavePath: vi.fn(),
      LoadProject: vi.fn(),
      SaveBinary: vi.fn(),
      UploadToPico: vi.fn(),
    }
  }
};

// Mock runtime for Wails
global.window.runtime = {
  EventsOn: vi.fn(),
  EventsEmit: vi.fn(),
};
