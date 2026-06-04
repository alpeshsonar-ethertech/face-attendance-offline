const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const config = { resolver: { assetExts: ['tflite', 'bin', 'png', 'jpg', 'jpeg', 'ttf'] } };
module.exports = mergeConfig(getDefaultConfig(__dirname), config);
