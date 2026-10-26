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
  overrides: [
    {
      // Node-only scripts (icon generator, migration helpers).
      files: ['tools/**/*.js', 'scripts/**/*.js'],
      env: { node: true },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
  ],
};
