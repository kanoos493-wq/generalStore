module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: ['android/', 'node_modules/', 'coverage/'],
  rules: {
    // `void promise` is used deliberately for fire-and-forget async calls.
    'no-void': 'off',
    // Constant-time comparison uses bitwise operators on purpose.
    'no-bitwise': 'off',
    'react-native/no-inline-styles': 'off',
  },
};
