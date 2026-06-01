// Manual mock — op-sqlite is a native module and cannot load in Jest.
// Auto-applied to any test importing the storage layer. Tests that exercise
// the DB inject a fake SqliteDatabase via setDb(); this just keeps `open`
// from loading native code.
module.exports = {
  open: jest.fn(() => ({
    execute: jest.fn(async () => ({ rows: [], rowsAffected: 0 })),
    transaction: jest.fn(),
    close: jest.fn(),
  })),
}
