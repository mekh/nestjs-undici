import { UndiciBaseConfig } from '../src';

describe('UndiciBaseConfig via environment variables', () => {
  const origEnv = process.env;
  let cfg: UndiciBaseConfig;

  beforeEach(() => {
    process.env = { ...origEnv };
    // Clean all related vars before each test
    delete process.env.UNDICI_BASE_URL;
    delete process.env.UNDICI_TIMEOUT;
    delete process.env.UNDICI_RAW_BODY;
    delete process.env.UNDICI_RAW_PARSE;
    delete process.env.UNDICI_RAW_RETRY;
    delete process.env.UNDICI_ERROR_STRATEGY;

    cfg = new UndiciBaseConfig();
  });

  afterAll(() => {
    process.env = origEnv;
  });

  describe('baseURL', () => {
    it('is undefined when not set', () => {
      expect(cfg.baseURL).toBeUndefined();
    });

    it('reads a string when set', () => {
      process.env.UNDICI_BASE_URL = 'https://example.com/api';
      cfg = new UndiciBaseConfig();
      expect(cfg.baseURL).toBe('https://example.com/api');
    });
  });

  describe('timeout', () => {
    it('is undefined when not set or set to non-number/zero', () => {
      expect(cfg.timeout).toBeUndefined();

      process.env.UNDICI_TIMEOUT = '0';
      cfg = new UndiciBaseConfig();
      expect(cfg.timeout).toBeUndefined();

      process.env.UNDICI_TIMEOUT = 'abc';
      cfg = new UndiciBaseConfig();
      expect(cfg.timeout).toBeUndefined();
    });

    it('parses a valid number', () => {
      process.env.UNDICI_TIMEOUT = '1500';
      cfg = new UndiciBaseConfig();
      expect(cfg.timeout).toBe(1500);
    });
  });

  describe('rawBody', () => {
    it('is false when not set or invalid', () => {
      expect(cfg.rawBody).toBe(false);

      process.env.UNDICI_RAW_BODY = 'yes';
      cfg = new UndiciBaseConfig();
      expect(cfg.rawBody).toBe(false);
    });

    it('parses literal true/false', () => {
      process.env.UNDICI_RAW_BODY = 'true';
      cfg = new UndiciBaseConfig();
      expect(cfg.rawBody).toBe(true);

      process.env.UNDICI_RAW_BODY = 'false';
      cfg = new UndiciBaseConfig();
      expect(cfg.rawBody).toBe(false);
    });
  });

  describe('parse', () => {
    it('is true when not set or invalid', () => {
      expect(cfg.parse).toBe(true);

      process.env.UNDICI_RAW_PARSE = 'invalid';
      cfg = new UndiciBaseConfig();
      expect(cfg.parse).toBe(true);
    });

    it('parses literal true/false from UNDICI_RAW_PARSE', () => {
      process.env.UNDICI_RAW_PARSE = 'true';
      cfg = new UndiciBaseConfig();
      expect(cfg.parse).toBe(true);

      process.env.UNDICI_RAW_PARSE = 'false';
      cfg = new UndiciBaseConfig();
      expect(cfg.parse).toBe(false);
    });
  });

  describe('retry', () => {
    it('is false when not set or invalid', () => {
      expect(cfg.retry).toBe(false);

      process.env.UNDICI_RAW_RETRY = 'on';
      cfg = new UndiciBaseConfig();
      expect(cfg.retry).toBe(false);
    });

    it('parses literal true/false from UNDICI_RAW_RETRY', () => {
      process.env.UNDICI_RAW_RETRY = 'true';
      cfg = new UndiciBaseConfig();
      expect(cfg.retry).toBe(true);

      process.env.UNDICI_RAW_RETRY = 'false';
      cfg = new UndiciBaseConfig();
      expect(cfg.retry).toBe(false);
    });
  });

  describe('errorStrategy', () => {
    it('is "throw" when not set', () => {
      expect(cfg.errorStrategy).toBe('throw');
    });

    it('reads a string value when set', () => {
      process.env.UNDICI_ERROR_STRATEGY = 'intercept';
      cfg = new UndiciBaseConfig();
      expect(cfg.errorStrategy).toBe('intercept');

      process.env.UNDICI_ERROR_STRATEGY = 'throw';
      cfg = new UndiciBaseConfig();
      expect(cfg.errorStrategy).toBe('throw');
    });
  });

  it('combined: reads all options simultaneously', () => {
    process.env.UNDICI_BASE_URL = 'http://localhost:3000';
    process.env.UNDICI_TIMEOUT = '2000';
    process.env.UNDICI_RAW_BODY = 'true';
    process.env.UNDICI_RAW_PARSE = 'false';
    process.env.UNDICI_RAW_RETRY = 'true';
    process.env.UNDICI_ERROR_STRATEGY = 'pass';

    cfg = new UndiciBaseConfig();

    expect(cfg.baseURL).toBe('http://localhost:3000');
    expect(cfg.timeout).toBe(2000);
    expect(cfg.rawBody).toBe(true);
    expect(cfg.parse).toBe(false);
    expect(cfg.retry).toBe(true);
    expect(cfg.errorStrategy).toBe('pass');
  });
});
