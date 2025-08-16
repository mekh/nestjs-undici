import { BaseConfig } from '../src/base.config';

describe('BaseConfig', () => {
  const cfg = new BaseConfig();
  const orig = process.env;

  beforeEach(() => {
    process.env = { ...orig };
  });

  afterAll(() => {
    process.env = orig;
  });

  it('asNumber returns undefined for missing or non-numeric, number for numeric', () => {
    delete process.env.NUM1;
    expect(cfg.asNumber('NUM1')).toBeUndefined();

    process.env.NUM2 = '0';
    expect(cfg.asNumber('NUM2')).toBeUndefined();

    process.env.NUM3 = '123';
    expect(cfg.asNumber('NUM3')).toBe(123);
  });

  it('asString returns the raw env value', () => {
    process.env.FOO = 'bar';
    expect(cfg.asString('FOO')).toBe('bar');
  });

  it('asBoolean returns true/false only for literal strings, else undefined', () => {
    delete process.env.FLAG1;
    expect(cfg.asBoolean('FLAG1')).toBeUndefined();

    process.env.FLAG2 = 'true';
    expect(cfg.asBoolean('FLAG2')).toBe(true);

    process.env.FLAG3 = 'false';
    expect(cfg.asBoolean('FLAG3')).toBe(false);

    process.env.FLAG4 = 'yes';
    expect(cfg.asBoolean('FLAG4')).toBeUndefined();
  });
});
