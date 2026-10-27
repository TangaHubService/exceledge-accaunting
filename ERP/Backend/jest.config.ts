import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  // Vitest is the canonical runner (`npm run test:unit`) — every suite imports
  // from 'vitest', and most rely on hoisted vi.mock() which jest cannot honor.
  // Jest additionally runs the fiscal suites that only use
  // describe/it/expect (+vi.spyOn), via the tests/vitest-jest-shim.ts bridge.
  testPathIgnorePatterns: [
    '/node_modules/',
    'product-validation.test.ts',
    'tests/(?!rra-ebm-compliance|invoice-pdf|invoice-pdf-proforma|fiscal-report-pdf|rra-totals-cases|daily-report-aggregate|fiscal-totals).*\\.test\\.ts$',
  ],
  moduleNameMapper: {
    '^vitest$': '<rootDir>/tests/vitest-jest-shim.ts',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
  clearMocks: true,
  collectCoverage: false,
  testTimeout: 10000,
};

export default config;
