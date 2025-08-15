import type { Config } from 'jest';

const config: Config = {
  displayName: 'undici',
  verbose: true,
  maxWorkers: 1,
  forceExit: true,
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: './',
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/*.spec.ts'],
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
  ],
  coveragePathIgnorePatterns: ['apps/**/main.ts'],
  detectOpenHandles: true,
  transform: {
    '^.+.tsx?$': ['ts-jest', {}],
  },
};

export default config;
