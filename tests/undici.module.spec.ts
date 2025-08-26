/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

jest.mock('undici', () => require('./__helpers__/undici-mock'));

import {
  UndiciConfig,
  UndiciConfigFactory,
  UndiciModule,
  UndiciService,
} from '../src';
import {
  makeResponse,
  request,
  resetUndiciMock,
} from './__helpers__/undici-mock';

const cfg: UndiciConfig = {
  baseURL: 'https://m/',
  parse: true,
  rawBody: false,
  retry: false,
  errorStrategy: 'throw',
};

@Injectable()
class FactoryClass implements UndiciConfigFactory {
  createUndiciConfig(): UndiciConfig {
    return { ...cfg };
  }
}

@Injectable()
class ExistingFactory implements UndiciConfigFactory {
  createUndiciConfig(): UndiciConfig {
    return { ...cfg };
  }
}

@Module({ providers: [ExistingFactory], exports: [ExistingFactory] })
class ExistingFactoryModule {}

describe('UndiciModule', () => {
  beforeEach(() => {
    resetUndiciMock();
    request.mockClear?.();
  });

  it('default config', async () => {
    process.env.UNDICI_BASE_URL = 'https://abs/';
    const moduleRef = await Test.createTestingModule({
      imports: [UndiciModule],
    }).compile();

    const svc = moduleRef.get(UndiciService);
    request.setNextResponse(makeResponse());
    const res = await svc.get('/x');
    expect(res.statusCode).toBe(200);
  });

  it('forRoot default config', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UndiciModule.forRoot({})],
    }).compile();

    const svc = moduleRef.get(UndiciService);
    expect(svc.defaults.timeout).toBeUndefined();
    expect(svc.defaults.rawBody).toBe(false);
    expect(svc.defaults.parse).toBe(true);
    expect(svc.defaults.retry).toBe(false);
    expect(svc.defaults.errorStrategy).toBe('throw');
  });

  it('forRoot default + provided config', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UndiciModule.forRoot({ rawBody: true })],
    }).compile();

    const svc = moduleRef.get(UndiciService);
    expect(svc.defaults.timeout).toBeUndefined();
    expect(svc.defaults.rawBody).toBe(true);
    expect(svc.defaults.parse).toBe(true);
    expect(svc.defaults.retry).toBe(false);
    expect(svc.defaults.errorStrategy).toBe('throw');
  });

  it('forRootAsync default config', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UndiciModule.forRootAsync({})],
    }).compile();

    const svc = moduleRef.get(UndiciService);
    expect(svc.defaults.timeout).toBeUndefined();
    expect(svc.defaults.rawBody).toBe(false);
    expect(svc.defaults.parse).toBe(true);
    expect(svc.defaults.retry).toBe(false);
    expect(svc.defaults.errorStrategy).toBe('throw');
  });

  it('forRootAsync useFactory default + provided config', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UndiciModule.forRootAsync({
        useFactory: (): UndiciConfig => ({
          retry: true,
          errorStrategy: 'pass',
        }),
      })],
    }).compile();

    const svc = moduleRef.get(UndiciService);
    expect(svc.defaults.timeout).toBeUndefined();
    expect(svc.defaults.rawBody).toBe(false);
    expect(svc.defaults.parse).toBe(true);
    expect(svc.defaults.retry).toBe(true);
    expect(svc.defaults.errorStrategy).toBe('pass');
  });

  it('forRoot provides service with provided options', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UndiciModule.forRoot(cfg)],
    }).compile();

    const svc = moduleRef.get(UndiciService);
    request.setNextResponse(makeResponse());
    const res = await svc.get('/x');
    expect(res.statusCode).toBe(200);
  });

  it('forRootAsync: useFactory', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        UndiciModule.forRootAsync({
          useFactory: async () => ({ ...cfg }),
          inject: [],
        }),
      ],
    }).compile();
    const svc = moduleRef.get(UndiciService);
    request.setNextResponse(makeResponse());
    const res = await svc.get('/x');
    expect(res.statusCode).toBe(200);
  });

  it('forRootAsync: useClass', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        UndiciModule.forRootAsync({
          providers: [FactoryClass],
          useClass: FactoryClass,
        }),
      ],
    }).compile();
    const svc = moduleRef.get(UndiciService);
    request.setNextResponse(makeResponse());
    const res = await svc.get('/x');
    expect(res.statusCode).toBe(200);
  });

  it('forRootAsync: useExisting', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        UndiciModule.forRootAsync({
          imports: [ExistingFactoryModule],
          useExisting: ExistingFactory,
        }),
      ],
    }).compile();
    const svc = moduleRef.get(UndiciService);
    request.setNextResponse(makeResponse());
    const res = await svc.get('/x');
    expect(res.statusCode).toBe(200);
  });

  it('forRootAsync: useValue', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        UndiciModule.forRootAsync({ useValue: { ...cfg } }),
      ],
    }).compile();
    const svc = moduleRef.get(UndiciService);
    request.setNextResponse(makeResponse());
    const res = await svc.get('/x');
    expect(res.statusCode).toBe(200);
  });

  it('forRootAsync: default fallback to {}', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UndiciModule.forRootAsync({})],
    }).compile();
    const svc = moduleRef.get(UndiciService);
    request.setNextResponse(makeResponse());
    const res = await svc.get('https://abs');
    expect(res.statusCode).toBe(200);
  });
});
