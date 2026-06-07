// Manual mock — expo-camera is a native module and can't load in Jest.
// CameraView renders a pressable that fires onBarcodeScanned with a fixed
// payload, so tests can simulate a scan. useCameraPermissions defaults to granted;
// override per-test with jest.spyOn / jest.mock as needed.
const React = require('react')
const { Pressable } = require('react-native')

const CameraView = ({ onBarcodeScanned, children }) =>
  React.createElement(
    Pressable,
    {
      testID: 'mock-barcode',
      onPress: () => onBarcodeScanned && onBarcodeScanned({ data: 'SCANNED_QR' }),
    },
    children
  )

const useCameraPermissions = jest.fn(() => [{ granted: true }, jest.fn()])

module.exports = { __esModule: true, CameraView, useCameraPermissions }
