module.exports = {
  projects: [
    {
      displayName: 'core',
      testEnvironment: 'node',
      transform: {
        '^.+\\.(js|jsx|ts|tsx)$': ['babel-jest', { configFile: './babel.config.js' }],
      },
      testMatch: [
        '<rootDir>/__tests__/core/**/*.test.ts',
        '<rootDir>/__tests__/db/**/*.test.ts',
        '<rootDir>/__tests__/services/**/*.test.ts',
        '<rootDir>/__tests__/perf/**/*.test.ts',
      ],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    },
    {
      displayName: 'ui',
      preset: '@react-native/jest-preset',
      testMatch: ['<rootDir>/__tests__/ui/**/*.test.tsx'],
      setupFiles: ['<rootDir>/__tests__/ui/setup.ts'],
      // The navigation libraries ship ESM only, so they must be transformed
      // for the shell tests that mount the real navigator.
      transformIgnorePatterns: [
        'node_modules/(?!(?:jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|react-native-safe-area-context|react-freeze|use-latest-callback|zustand|@noble)',
      ],
    },
  ],
  collectCoverageFrom: ['src/core/**/*.ts', 'src/services/**/*.ts', 'src/db/**/*.ts'],
};
