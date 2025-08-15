/* eslint-disable @typescript-eslint/no-unsafe-member-access */
export type MockBodyInit = {
  text?: string;
  arrayBuffer?: ArrayBufferLike;
};

export class MockBody {
  private readonly _text?: string;

  private readonly _arrayBuffer?: ArrayBufferLike;

  constructor(init: MockBodyInit = {}) {
    this._text = init.text;
    this._arrayBuffer = init.arrayBuffer;
  }

  async text(): Promise<string> {
    if (typeof this._text === 'string') {
      return this._text;
    }
    if (this._arrayBuffer) {
      return new TextDecoder('utf-8').decode(this._arrayBuffer as any);
    }
    return '';
  }

  async arrayBuffer(): Promise<ArrayBufferLike> {
    if (this._arrayBuffer) {
      return this._arrayBuffer;
    }

    return new TextEncoder().encode(this._text ?? '').buffer;
  }
}

export class ResponseStatusCodeError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public headers: Record<string, any>,
    public body: any,
  ) {
    super(message);
    this.name = 'ResponseStatusCodeError';
  }
}

export const errors = {
  ResponseStatusCodeError,
};

let poolInstances: Pool[] = [];

export class Agent {
  closed = false;

  constructor(public options?: any) {}

  async close(): Promise<void> {
    this.closed = true;
  }
}

export class Pool {
  closed = false;

  static created: { origin: string; options: any }[] = [];

  constructor(public origin: string, public options?: any) {
    poolInstances.push(this);
    Pool.created.push({ origin, options });
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

export class RetryAgent {
  closed = false;

  constructor(public dispatcher: any, public options?: any) {}

  async close(): Promise<void> {
    this.closed = true;
  }
}

export class FormData {}

export function getPoolInstances(): Pool[] {
  return poolInstances;
}

export type MockRequestCall = {
  url: URL;
  options: any;
};

export const mockRequests: MockRequestCall[] = [];

export function resetUndiciMock(): void {
  mockRequests.length = 0;
  Pool.created = [];
  poolInstances = [];
}

export type MockResponseInit = {
  statusCode?: number;
  headers?: Record<string, string | string[]>;
  body?: MockBody;
};

export function makeResponse(init: MockResponseInit = {}): {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: MockBody;
} {
  return {
    statusCode: init.statusCode ?? 200,
    headers: init.headers ?? {},
    body: init.body ?? new MockBody({ text: '' }),
  };
}

export const request = jest.fn(async (url: URL, options: any) => {
  mockRequests.push({ url, options });
  // Allow tests to pre-program the return via request.mockResolvedValueOnce
  // or fall back to a default 200 response
  if (request._nextResponse) {
    const res = request._nextResponse;
    request._nextResponse = undefined;

    return res;
  }
  return makeResponse();
}) as any;

request.setNextResponse = (res: any): void => {
  request._nextResponse = res;
};
