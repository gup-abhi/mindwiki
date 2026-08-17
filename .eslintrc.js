// https://docs.expo.dev/guides/using-eslint/
module.exports = {
  extends: 'expo',
  env: {
    jest: true,
  },
  ignorePatterns: ['/dist/*', '/demo/*', '/server/*'],
  overrides: [
    {
      files: ['src/services/**/*.ts', 'src/services/**/*.tsx'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@/store/*'],
                message: 'Core services must not import Zustand stores; use an application adapter boundary.',
              },
            ],
          },
        ],
      },
    },
    {
      files: [
        'src/services/auth/api-client.ts',
        'src/services/auth/auth.service.ts',
        'src/services/auth/session-reset.ts',
        'src/services/onboarding/first-run.ts',
        'src/services/sync/engine.ts',
        'src/services/sync/pairing.ts',
        'src/services/storage/sync-queue.ts',
        'src/services/pipeline.ts',
      ],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
}
