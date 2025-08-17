/* eslint-disable @typescript-eslint/no-unsafe-member-access,max-len */
import { FormData } from 'undici';
import {
  UndiciRequestConfig,
  UndiciRequestInterceptor,
  UndiciResponse,
  UndiciResponseInterceptor,
} from '../src';
import { Interceptors } from '../src/interceptors';
import { RequestInterceptors } from '../src/interceptors/req.interceptors';
import { ResponseInterceptors } from '../src/interceptors/res.interceptors';

/**
 * Helper to build a minimal UndiciRequestConfig for tests
 */
const makeReqConfig = (
  overrides: Partial<UndiciRequestConfig> = {},
): UndiciRequestConfig => {
  const base: any = {
    url: new URL('https://example.com/test'),
    method: 'GET',
    headers: {},
    // Additional fields used by our interceptors implementation
    query: {},
    ...overrides,
  };
  return base as UndiciRequestConfig;
};

/**
 * Build a minimal UndiciResponse for tests
 */
const makeRes = (
  overrides: Partial<UndiciResponse<any>> = {},
): UndiciResponse<any> => {
  const base: any = {
    statusCode: 200,
    headers: {},
    trailers: {},
    opaque: null,
    body: null,
    rawBody: null,
    ...overrides,
  };
  return base as UndiciResponse<any>;
};

describe('AbstractInterceptors add/remove behavior via concrete classes', () => {
  it('add returns the same interceptor and remove deletes it; removing non-existent is no-op', async () => {
    const reqInt = new RequestInterceptors([]);

    const calls: string[] = [];
    const i1: UndiciRequestInterceptor = async (cfg) => {
      calls.push('i1');
      return cfg;
    };
    const i2: UndiciRequestInterceptor = async (cfg) => {
      calls.push('i2');
      return cfg;
    };

    const added = reqInt.add(i1);
    expect(added).toBe(i1);

    reqInt.add(i2);

    // Remove a non-added interceptor (no-op path)
    const dummy: UndiciRequestInterceptor = async (cfg) => cfg;
    reqInt.remove(dummy);

    // Apply should still run i1 and i2
    const cfg0 = makeReqConfig();
    const cfg1 = await reqInt.apply(cfg0);
    expect(calls).toEqual(['i1', 'i2']);
    // the same object reference is returned unless interceptors repoint it
    expect(cfg1.url).toBe(cfg0.url);

    // Now remove i1 and ensure only i2 runs
    reqInt.remove(i1);
    calls.length = 0;
    await reqInt.apply(cfg0);
    expect(calls).toEqual(['i2']);
  });
});

describe('RequestInterceptors.apply', () => {
  it('applies constructor-provided interceptors in order with shallow copies', async () => {
    const seenBodies: any[] = [];
    const i1: UndiciRequestInterceptor = async (cfg) => {
      // mutate copies
      cfg.headers = { ...cfg.headers, a: '1' };
      cfg.query = { ...cfg.query, x: '1' };
      if (cfg.body && typeof cfg.body === 'object') {
        (cfg.body as any).n = 1;
      }
      return cfg;
    };
    const i2: UndiciRequestInterceptor = async (cfg) => {
      // capture that body is a different object instance each time (for a plain-object case)
      seenBodies.push(cfg.body);
      cfg.headers = { ...cfg.headers, b: '2' };
      cfg.query = { ...cfg.query, y: '2' };
      if (cfg.body && typeof cfg.body === 'object') {
        (cfg.body as any).m = 2;
      }
      return cfg;
    };

    const reqInt = new RequestInterceptors([i1, i2]);

    const originalBody = { k: true };
    const cfg0 = makeReqConfig({
      headers: { h: '0' },
      body: originalBody,
      requestInterceptors: undefined,
    });

    const result = await reqInt.apply(cfg0);

    // The final result should include changes returned by interceptors
    expect(result.headers).toEqual({ h: '0', a: '1', b: '2' });
    expect((result as any).query).toEqual({ x: '1', y: '2' });
    expect(result.body).toEqual({ k: true, n: 1, m: 2 });

    // Ensure shallow copy per interceptor: body instances seen by i2 should not be the same as original, but content updated
    expect(seenBodies).toHaveLength(1);
    expect(seenBodies[0]).not.toBe(originalBody);
    // However, updated fields from i1 should be present when i2 runs
    expect(seenBodies[0]).toEqual({ k: true, n: 1, m: 2 });
  });

  it('uses per-request requestInterceptors if provided', async () => {
    const called: string[] = [];
    const ctorInt = new RequestInterceptors([
      async (cfg): Promise<UndiciRequestConfig> => {
        called.push('ctor');
        return cfg;
      },
    ]);

    const cfg0 = makeReqConfig({
      requestInterceptors: [async (cfg): Promise<UndiciRequestConfig> => {
        called.push('per-request');
        return cfg;
      }],
    });

    await ctorInt.apply(cfg0);

    expect(called).toEqual(['per-request']);
  });

  it('shallowCopy keeps non-plain body by reference (Buffer, FormData, URLSearchParams, TypedArray, ArrayBuffer, stream-like)', async () => {
    const buf = Buffer.from('abc');
    const ab = new ArrayBuffer(8);
    const u8 = new Uint8Array(4);
    const usp = new URLSearchParams('a=1');
    const fd = new FormData();
    const streamLike: any = { pipe: () => {} };

    const bodies = [buf, ab, u8, usp, fd, streamLike as any];

    for (const body of bodies) {
      const seen: any[] = [];
      const i: UndiciRequestInterceptor = async (cfg) => {
        seen.push(cfg.body);
        return cfg;
      };
      const ri = new RequestInterceptors([i]);
      const cfg0 = makeReqConfig({ body });
      await ri.apply(cfg0);
      expect(seen[0]).toBe(body);
    }
  });
});

describe('ResponseInterceptors.apply', () => {
  it('applies constructor-provided interceptors in order and returns final response', async () => {
    const called: string[] = [];
    const i1: UndiciResponseInterceptor = async (res) => {
      called.push('i1');
      return { ...res, statusCode: 201 };
    };
    const i2: UndiciResponseInterceptor = async (res) => {
      called.push('i2');
      return { ...res, headers: { mod: 'true' } };
    };

    const ri = new ResponseInterceptors([i1, i2]);

    const res0 = makeRes();
    const cfg0 = makeReqConfig();

    const out = await ri.apply<any>(res0, cfg0);
    expect(called).toEqual(['i1', 'i2']);
    expect(out.statusCode).toBe(201);
    expect(out.headers).toEqual({ mod: 'true' });
  });

  it('uses per-request responseInterceptors if provided and passes error argument', async () => {
    const seenError: any[] = [];
    const ctor = new ResponseInterceptors([
      async (res): Promise<UndiciResponse<any>> => res,
    ]);

    const perReq: UndiciResponseInterceptor = async (res, err) => {
      seenError.push(err);
      return res;
    };
    const cfg0 = makeReqConfig({ responseInterceptors: [perReq] });

    const err = new Error('boom');
    await ctor.apply(makeRes(), cfg0, err);

    expect(seenError).toEqual([err]);
  });
});

describe('Interceptors factory and composition', () => {
  it('Interceptors.create wires up request and response interceptors', async () => {
    const calls: string[] = [];
    const rq: UndiciRequestInterceptor = async (cfg) => {
      calls.push('rq');
      return cfg;
    };
    const rs: UndiciResponseInterceptor = async (res) => {
      calls.push('rs');
      return res;
    };

    const all = Interceptors.create([rq], [rs]);

    const cfg0 = makeReqConfig();
    await all.request.apply(cfg0);
    await all.response.apply(makeRes(), cfg0);

    expect(calls).toEqual(['rq', 'rs']);
  });
});
