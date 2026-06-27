// Manual mock — llama.rn is a native module and cannot load in Jest.
// Default: a context whose completion returns empty JSON. Tests that need
// specific output use jest.doMock to override.
module.exports = {
  initLlama: jest.fn(async () => ({
    completion: jest.fn(async () => ({
      text: '{}',
      tokens_predicted: 0,
      timings: { predicted_per_second: 0 },
    })),
    release: jest.fn(),
    gpu: false,
    reasonNoGPU: '',
    devices: [],
  })),
  getBackendDevicesInfo: jest.fn(async () => []),
}
