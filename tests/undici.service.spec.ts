/* eslint-disable @typescript-eslint/no-unsafe-member-access,max-len */
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('undici', () => require('./__helpers__/undici-mock'));

import {
  Agent,
  FormData,
  MockBody,
  Pool,
  RetryAgent,
  errors,
  getPoolInstances,
  makeResponse,
  mockRequests,
  request,
  resetUndiciMock,
} from './__helpers__/undici-mock';

import { UndiciConfig, UndiciService } from '../src';
import { UNDICI_CLIENT_OPTIONS } from '../src/undici.constants';

const createModule = async (
  config: Partial<UndiciConfig> = {},
): Promise<TestingModule> => {
  return Test.createTestingModule({
    providers: [
      UndiciService,
      {
        provide: UNDICI_CLIENT_OPTIONS,
        useValue: {
          baseURL: 'https://api.local/',
          parse: true,
          rawBody: false,
          retry: false,
          ...config,
        } satisfies UndiciConfig,
      },
    ],
  }).compile();
};

const enc = new TextEncoder();

describe('UndiciService', () => {
  beforeEach(() => {
    resetUndiciMock();
    request.mockClear?.();
  });

  it('serialize JSON body and set content-type when missing', async () => {
    const moduleRef = await createModule();
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(
      makeResponse({
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: new MockBody({ arrayBuffer: enc.encode('{"ok":true}').buffer }),
      }),
    );

    const res = await service.post<{ ok: boolean }>(
      '/foo',
      { x: 1 },
    );

    expect(res).toEqual({
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: { ok: true },
      rawBody: null,
    });

    const call = mockRequests[0];
    expect(call.options.headers['content-type']).toBe('application/json');
    expect(call.options.body).toBe('{"x":1}');
    expect(call.options.method).toBe('POST');
  });

  it('throws if object body with non-json content-type', async () => {
    const moduleRef = await createModule();
    const service = moduleRef.get(UndiciService);

    await expect(
      service.post('/bar', { y: 2 }, {
        headers: { 'content-type': 'text/plain' },
      }),
    ).rejects.toThrow('Request body must be a string or a Buffer.');
  });

  it('buildUrl: absolute path', async () => {
    const moduleRef = await createModule({
      baseURL: 'https://base.example/api/',
    });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(makeResponse());
    await service.get('https://other.host/a');
    expect(mockRequests[0].url.href).toBe('https://other.host/a');
  });

  it('buildUrl: relative path', async () => {
    const moduleRef = await createModule({
      baseURL: 'https://base.example/api/',
    });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(makeResponse());
    await service.get('/v1/items');
    expect(mockRequests[0].url.href).toBe('https://base.example/api/v1/items');
  });

  it('buildUrl: throws for relative path without baseURL', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UndiciService,
        { provide: UNDICI_CLIENT_OPTIONS, useValue: {} },
      ],
    }).compile();
    const service = moduleRef.get(UndiciService);

    await expect(service.get('/relative')).rejects.toThrow(
      'baseURL is not set',
    );
  });

  it('parse=false returns BodyReadable (MockBody) untouched', async () => {
    const moduleRef = await createModule({ parse: false, rawBody: true });
    const service = moduleRef.get(UndiciService);

    const body = new MockBody({ text: 'abc' });
    request.setNextResponse(
      makeResponse({
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
        body,
      }),
    );

    const res = await service.get<any>('/x');
    expect(res.body).toBe(body);
    expect(res.rawBody).toBe(body);
  });

  it('parse: empty body', async () => {
    const moduleRef = await createModule({ rawBody: true });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(
      makeResponse({
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
        body: new MockBody({ arrayBuffer: new ArrayBuffer(0) }),
      }),
    );
    const res = await service.get('/empty');
    expect(res.body).toBeNull();
    expect(res.rawBody).toBeInstanceOf(ArrayBuffer);
  });

  it('parse: text', async () => {
    const moduleRef = await createModule({ rawBody: true });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(
      makeResponse({
        statusCode: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: new MockBody({ arrayBuffer: enc.encode('hi').buffer }),
      }),
    );
    const res = await service.get('/text');
    expect(res.body).toBe('hi');
    expect(res.rawBody).toBe('hi');
  });

  it('parse: unknown content-type', async () => {
    const moduleRef = await createModule({ rawBody: true });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(
      makeResponse({
        statusCode: 200,
        headers: { 'content-type': 'application/octet-stream' },
        body: new MockBody({ arrayBuffer: enc.encode('bin').buffer }),
      }),
    );
    const res = await service.get<ArrayBuffer>('/bin');
    expect(res.body).toBeInstanceOf(ArrayBuffer);
    expect(res.rawBody).toBeInstanceOf(ArrayBuffer);
  });

  it('parse: json with BOM and spaces', async () => {
    const moduleRef = await createModule({ rawBody: true });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(
      makeResponse({
        statusCode: 200,
        headers: { 'Content-Type': 'Application/Foo+Json; charset=UTF-8' },
        body: new MockBody({
          arrayBuffer: enc.encode('\uFEFF  { "a" :  1 } ').buffer,
        }),
      }),
    );
    const res = await service.get<{ a: number }>('/json');
    expect(res.body).toEqual({ a: 1 });
    expect(res.rawBody).toMatch('{ "a" :  1 }');
  });

  it('status 204 returns null bodies', async () => {
    const moduleRef = await createModule();
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(
      makeResponse({
        statusCode: 204,
        headers: {},
        body: new MockBody({ text: '' }),
      }),
    );
    const res = await service.get('/no-content');
    expect(res.body).toBeNull();
    expect(res.rawBody).toBeNull();
  });

  it('status 205 returns null bodies', async () => {
    const moduleRef = await createModule();
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(
      makeResponse({
        statusCode: 205,
        headers: {},
        body: new MockBody({ text: '' }),
      }),
    );
    const res = await service.get('/reset-content');
    expect(res.body).toBeNull();
    expect(res.rawBody).toBeNull();
  });

  it('parse: malformed json throws and logs debug', async () => {
    const moduleRef = await createModule();
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(
      makeResponse({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: new MockBody({ arrayBuffer: enc.encode('invalid {').buffer }),
      }),
    );
    await expect(service.get('/bad-json')).rejects.toThrow();
  });

  it('errorStrategy: default throw consumes error body and throws', async () => {
    const moduleRef = await createModule();
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(
      makeResponse({
        statusCode: 500,
        headers: { 'content-type': 'text/plain' },
        body: new MockBody({ text: 'oops' }),
      }),
    );

    await expect(service.get('/err')).rejects.toMatchObject({
      name: 'ResponseStatusCodeError',
      statusCode: 500,
    });
  });

  it('errorStrategy: pass returns response with error', async () => {
    const moduleRef = await createModule({
      errorStrategy: 'pass',
      rawBody: false,
    });
    const service = moduleRef.get(UndiciService);
    request.setNextResponse(
      makeResponse({
        statusCode: 404,
        headers: {},
        body: new MockBody({ text: 'nf' }),
      }),
    );
    const res: any = await service.get('/nf');
    expect(res.error).toBeInstanceOf(errors.ResponseStatusCodeError);
    expect(res.rawBody).toBeNull();
  });

  it('errorStrategy: pass returns response with error and rawBody', async () => {
    const moduleRef = await createModule({
      errorStrategy: 'pass',
      rawBody: true,
    });
    const service = moduleRef.get(UndiciService);
    request.setNextResponse(
      makeResponse({
        statusCode: 400,
        headers: {},
        body: new MockBody({ text: 'bad' }),
      }),
    );
    const res = await service.get('/bad');
    expect(res.rawBody).toBeInstanceOf(MockBody);
  });

  it('errorStrategy: invokes interceptors with parsed body and error', async () => {
    const interceptor = jest.fn(async (resp, err) => {
      expect(err).toBeInstanceOf(errors.ResponseStatusCodeError);
      expect(err.body).toContain('"x":1');
      return { ...resp, body: { wrapped: resp.body } };
    });
    const moduleRef = await createModule({
      errorStrategy: 'intercept',
      responseInterceptors: [interceptor],
    });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(
      makeResponse({
        statusCode: 500,
        headers: { 'content-type': 'application/json' },
        body: new MockBody({ arrayBuffer: enc.encode('{"x":1}').buffer }),
      }),
    );

    const res = await service.get<any>('/err2');
    expect(interceptor).toHaveBeenCalled();
    expect(res.body).toEqual({ wrapped: { x: 1 } });
  });

  it('errorStrategy: intercept without interceptors throws', async () => {
    const moduleRef = await createModule({ errorStrategy: 'intercept' });
    const service = moduleRef.get(UndiciService);
    request.setNextResponse(
      makeResponse({
        statusCode: 500,
        headers: {},
        body: new MockBody({ text: 'e' }),
      }),
    );
    await expect(service.get('/e')).rejects.toBeInstanceOf(
      errors.ResponseStatusCodeError,
    );
  });

  it('request interceptors: cloning and modifications are applied', async () => {
    const i1 = jest.fn(async (cfg) => {
      return {
        ...cfg,
        headers: { ...(cfg.headers ?? {}), A: '1' },
        body: { a: 1 },
      };
    });
    const i2 = jest.fn(async (cfg) => {
      // mutate the received body to ensure a shallow copy prevents external leaks
      if (cfg.body && typeof cfg.body === 'object') {
        (cfg.body as any).a = 2;
      }
      return cfg;
    });
    const moduleRef = await createModule({ requestInterceptors: [i1, i2] });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(makeResponse());
    const res = await service.post('/x', { foo: 'bar' });
    expect(res.statusCode).toBe(200);

    const call = mockRequests[0];
    expect(call.options.headers.A).toBe('1');
    expect(call.options.body).toBe('{"a":2}');
  });

  it('getHeader is case-insensitive (covered via parsing)', async () => {
    const moduleRef = await createModule();
    const service = moduleRef.get(UndiciService);
    request.setNextResponse(
      makeResponse({
        statusCode: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: new MockBody({ arrayBuffer: enc.encode('ok').buffer }),
      }),
    );
    const res = await service.get('/header');
    expect(res.body).toBe('ok');
  });

  it('isPlainObject ignores Buffer, ArrayBuffer views, URLSearchParams, streams, FormData', async () => {
    const moduleRef = await createModule();
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(makeResponse());

    await service.post('/buf', Buffer.from('x'));
    await service.post('/u8', new Uint8Array([1, 2]));
    await service.post('/sp', new URLSearchParams('a=1'));
    await service.post('/fd', new FormData());

    const streamLike: any = { pipe: () => {} };
    await service.post('/stream', streamLike);

    // Make sure there were 5 calls
    expect(mockRequests.length).toBe(5);
  });

  it('createAbortSignal covers timeout only', async () => {
    const moduleRef = await createModule({ timeout: undefined });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(makeResponse());
    await service.get('/t', { timeout: 10 });
    expect(mockRequests.pop()?.options.signal).toBeDefined();
  });

  it('createAbortSignal covers user only', async () => {
    const moduleRef = await createModule({ timeout: undefined });
    const service = moduleRef.get(UndiciService);

    const ac = new AbortController();
    request.setNextResponse(makeResponse());
    await service.get('/u', { signal: ac.signal });
    expect(mockRequests.pop()?.options.signal).toBe(ac.signal);
  });

  it('createAbortSignal covers both', async () => {
    const moduleRef = await createModule({ timeout: undefined });
    const service = moduleRef.get(UndiciService);

    const ac = new AbortController();
    request.setNextResponse(makeResponse());
    await service.get('/b', { timeout: 5, signal: ac.signal });
    expect(mockRequests.pop()?.options.signal).toBeDefined();
  });

  it('createAbortSignal covers none', async () => {
    const moduleRef = await createModule({ timeout: undefined });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(makeResponse());
    await service.get('/n');
    expect(mockRequests.pop()?.options.signal).toBeUndefined();
  });

  it('dispatcher selection: no pool creates Agent per request and closes it; retry off', async () => {
    const moduleRef = await createModule({ pool: false, retry: false });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(makeResponse());
    await service.get('https://host/a', { tls: { ca: 'ca' } });

    const { dispatcher } = mockRequests[0].options;

    expect(dispatcher).toBeInstanceOf(Agent);
    expect(dispatcher.closed).toBe(true);
  });

  it('dispatcher selection: no Agent should be created if no tls and retry options are passed', async () => {
    const moduleRef = await createModule({ pool: false, retry: false });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(makeResponse());
    await service.get('https://host/a');

    const { dispatcher } = mockRequests[0].options;

    expect(dispatcher).not.toBeInstanceOf(Agent);
  });

  it('dispatcher selection: pool true caches Pool per origin and applies tls/connect options', async () => {
    const moduleRef = await createModule({ pool: true });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(makeResponse());
    await service.get('https://o/a');

    request.setNextResponse(makeResponse());
    await service.get('https://o/b');

    expect(Pool.created.length).toBe(1);

    await service.onModuleDestroy();
    const pools = getPoolInstances();
    expect(pools[0].closed).toBe(true);
  });

  it('dispatcher selection: custom dispatcher is wrapped by RetryAgent when retry enabled and closed on destroy', async () => {
    const dispatcher = new Agent();
    const moduleRef = await createModule({
      dispatcher: dispatcher as any,
      retry: { retries: 1 } as any,
    });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(makeResponse());
    await service.get('https://x/a');

    const { dispatcher: disp } = mockRequests[0].options;
    expect(disp).toBeInstanceOf(RetryAgent);

    await service.onModuleDestroy();
    expect(disp.closed).toBe(true);
  });

  it('convenience methods set proper HTTP method', async () => {
    const moduleRef = await createModule();
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(makeResponse());
    await service.get('/a');
    expect(mockRequests[0].options.method).toBe('GET');

    request.setNextResponse(makeResponse());
    await service.delete('/b');
    expect(mockRequests[1].options.method).toBe('DELETE');

    request.setNextResponse(makeResponse());
    await service.put('/c', 'x');
    expect(mockRequests[2].options.method).toBe('PUT');

    request.setNextResponse(makeResponse());
    await service.patch('/d', 'y');
    expect(mockRequests[3].options.method).toBe('PATCH');

    request.setNextResponse(makeResponse());
    await service.post('/e', 'z');
    expect(mockRequests[4].options.method).toBe('POST');
  });

  it('wrapDispatcher does not double-wrap when dispatcher is already RetryAgent', async () => {
    const base = new Agent();
    const wrapped = new RetryAgent(base as any, { retries: 3 } as any);
    const moduleRef = await createModule({
      dispatcher: wrapped as any,
      retry: true,
    });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(makeResponse());
    await service.get('https://y/a');

    const dispUsed = (mockRequests[0].options as any).dispatcher;
    expect(dispUsed).toBe(wrapped);

    await service.onModuleDestroy();
    expect((wrapped as any).closed).toBe(true);
  });

  it('json content with only whitespace yields body null and rawBody text', async () => {
    const moduleRef = await createModule({ rawBody: true });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(
      makeResponse({
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: new MockBody({ arrayBuffer: enc.encode('   \n\t ').buffer }),
      }),
    );

    const res = await service.get('/json-ws');
    expect(res.body).toBeNull();
    expect(res.rawBody).toBe('   \n\t ');
  });

  it('onModuleDestroy logs debug when pool.close rejects', async () => {
    const moduleRef = await createModule({ pool: true });
    const service = moduleRef.get(UndiciService) as any;

    request.setNextResponse(makeResponse());
    await service.get('https://z/a');

    const pools = getPoolInstances();
    // Force close to reject
    pools[0].close = (async () => {
      throw new Error('close failed');
    }) as any;

    const debugSpy = jest.spyOn(service.dispatchers.logger, 'debug')
      .mockImplementation();

    await service.onModuleDestroy();

    expect(debugSpy).toHaveBeenCalledWith(
      'Failed to close connection pool',
      expect.any(Error),
    );
  });

  it('parse: normal JSON without BOM parses via sanitized false branch', async () => {
    const moduleRef = await createModule();
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(
      makeResponse({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: new MockBody({ arrayBuffer: enc.encode('{"b":2}').buffer }),
      }),
    );

    const res = await service.get<{ b: number }>('/json2');
    expect(res.body).toEqual({ b: 2 });
  });

  it('getHeader returns first element when header value is an array', async () => {
    const moduleRef = await createModule();
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(
      makeResponse({
        statusCode: 200,
        headers: { 'Content-Type': ['text/plain; charset=utf-8', 'ignored'] },
        body: new MockBody({ arrayBuffer: enc.encode('ok2').buffer }),
      }),
    );

    const res = await service.get<string>('/hdr-array');
    expect(res.body).toBe('ok2');
  });

  it('applyRequestInterceptors shallowCopy does not clone non-plain body', async () => {
    const buffer = Buffer.from('data');
    const i1 = async (cfg: any): Promise<any> => ({ ...cfg, body: buffer });
    const i2 = async (cfg: any): Promise<any> => {
      expect(cfg.body).toBe(buffer);
      return cfg;
    };
    const moduleRef = await createModule({ requestInterceptors: [i1, i2] });
    const service = moduleRef.get(UndiciService);
    request.setNextResponse(makeResponse());
    await service.post('/buf-noclone', buffer);
  });

  it('wrapDispatcher wraps Agent with RetryAgent when retry=true (boolean)', async () => {
    const moduleRef = await createModule({ pool: false, retry: true });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(makeResponse());
    await service.get('https://retry.bool/a');

    const disp = (mockRequests.pop() as any).options.dispatcher;
    expect(disp).toBeInstanceOf(RetryAgent);
  });

  it('errorStrategy defaults to intercept when interceptors exist (no explicit strategy)', async () => {
    const interceptor = jest.fn((resp, err) => resp);
    const moduleRef = await createModule({
      responseInterceptors: [interceptor],
    });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(
      makeResponse({
        statusCode: 500,
        headers: { 'content-type': 'application/json' },
        body: new MockBody({ arrayBuffer: enc.encode('{"err":1}').buffer }),
      }),
    );

    const res = await service.get<any>('/default-intercept');
    expect(res.statusCode).toBe(500);
    expect(interceptor).toHaveBeenCalled();
  });

  it('does not set content-type if header already present for JSON object body', async () => {
    const moduleRef = await createModule();
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(makeResponse());
    await service.post('/json-hdr', { v: 1 }, {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    } as any);

    const call = mockRequests.pop()!;
    expect(call.options.headers['content-type']).toBe(
      'application/json; charset=utf-8',
    );
    expect(call.options.body).toBe('{"v":1}');
  });

  it('does not auto-close dispatcher provided in request options', async () => {
    const moduleRef = await createModule({ pool: false });
    const service = moduleRef.get(UndiciService);

    const agent = new Agent();
    request.setNextResponse(makeResponse());
    await service.get(
      'https://req.disp/a',
      { dispatcher: agent as any } as any,
    );

    expect((agent as any).closed).toBe(false);
  });

  it('uses pool options object when pool is an object', async () => {
    const poolOptions = { connections: 2, pipelining: 1 } as any;
    const moduleRef = await createModule({ pool: poolOptions });
    const service = moduleRef.get(UndiciService);

    request.setNextResponse(makeResponse());
    await service.get('https://poo.lo/a');

    expect(Pool.created).toHaveLength(1);
    expect(Pool.created[0].options).toBeDefined();
  });
});
