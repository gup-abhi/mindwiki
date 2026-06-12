// Stand-in for `.txt` asset imports under Jest so the 1.3 MB vendored library
// bundle is never parsed by the test runner. The asset reference is mocked at
// the expo-asset boundary in the component tests.
module.exports = 1
