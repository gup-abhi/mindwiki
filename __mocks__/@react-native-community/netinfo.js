// Manual mock — netinfo is a native module and can't load in Jest.
// addEventListener returns an unsubscribe fn (matching the real API).
module.exports = {
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
    configure: jest.fn(),
  },
}
