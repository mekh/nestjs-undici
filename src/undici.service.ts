import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  Agent,
  Dispatcher,
  FormData,
  Pool,
  RetryAgent,
  errors,
  request,
} from 'undici';

import { UNDICI_CLIENT_OPTIONS } from './undici.constants';
import {
  UndiciConfig,
  UndiciOptionsDelete,
  UndiciOptionsGet,
  UndiciOptionsPatch,
  UndiciOptionsPost,
  UndiciOptionsPut,
  UndiciRequestBody,
  UndiciRequestConfig,
  UndiciRequestOptions,
  UndiciResponse,
} from './undici.interfaces';

type Raw = string | Buffer | ArrayBuffer;

@Injectable()
export class UndiciService implements OnModuleDestroy {
  private readonly logger = new Logger(UndiciService.name);

  private readonly pools = new Map<string, Dispatcher>();

  private readonly dispatcher?: Dispatcher;

  constructor(
    @Inject(UNDICI_CLIENT_OPTIONS) private readonly config: UndiciConfig,
  ) {
    if (this.config.dispatcher) {
      this.dispatcher = this.wrapDispatcher(this.config.dispatcher);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing all connections...');
    if (this.dispatcher) {
      await this.dispatcher.close();
    }

    await Promise.all(
      [...this.pools.values()].map((pool) => {
        pool.close().catch((e) => {
          this.logger.debug('Failed to close connection pool', e);
        });
      }),
    );

    this.logger.log('All connections closed.');
  }

  async get<TBody, TRaw = Raw>(
    path: string,
    options?: UndiciOptionsGet,
  ): Promise<UndiciResponse<TBody, TRaw>> {
    return this.request<TBody, TRaw>({ ...options, path, method: 'GET' });
  }

  async post<TBody, TRaw = Raw>(
    path: string,
    body: UndiciRequestBody,
    options?: UndiciOptionsPost,
  ): Promise<UndiciResponse<TBody, TRaw>> {
    return this.request<TBody, TRaw>({
      ...options,
      path,
      method: 'POST',
      body,
    });
  }

  async put<TBody, TRaw = Raw>(
    path: string,
    body: UndiciRequestBody,
    options?: UndiciOptionsPut,
  ): Promise<UndiciResponse<TBody, TRaw>> {
    return this.request<TBody, TRaw>({ ...options, path, method: 'PUT', body });
  }

  async patch<TBody, TRaw = Raw>(
    path: string,
    body: UndiciRequestBody,
    options?: UndiciOptionsPatch,
  ): Promise<UndiciResponse<TBody, TRaw>> {
    return this.request<TBody, TRaw>({
      ...options,
      path,
      method: 'PATCH',
      body,
    });
  }

  async delete<TBody, TRaw = Raw>(
    path: string,
    options?: UndiciOptionsDelete,
  ): Promise<UndiciResponse<TBody, TRaw>> {
    return this.request<TBody, TRaw>({ ...options, path, method: 'DELETE' });
  }

  public async request<TBody, TRaw>(
    options: UndiciRequestOptions,
  ): Promise<UndiciResponse<TBody, TRaw>> {
    const { path, ...opts } = options;

    const reqConfig = await this.applyRequestInterceptors({
      ...opts,
      url: this.buildUrl(options.path),
    });

    const requestUrl = reqConfig.url;
    const requestHeaders = { ...reqConfig.headers };
    const dispatcher = reqConfig.dispatcher ??
      this.getDispatcher(requestUrl, reqConfig);

    const ct = this.getHeader(requestHeaders, 'content-type');
    const isJsonCt = !ct || this.isJsonContentType(ct);

    let requestBody = reqConfig.body;
    if (isJsonCt && this.isPlainObject(requestBody)) {
      requestBody = JSON.stringify(requestBody);
      if (!ct) {
        requestHeaders['content-type'] = 'application/json';
      }
    }

    if (this.isPlainObject(requestBody)) {
      throw new Error(
        [
          'Request body must be a string or a Buffer.',
          `Received: ${typeof requestBody}`,
          'Please check if the content-type header is set correctly.',
          'Automatic serialization works only for JSON or empty content-types.',
        ].join(' '),
      );
    }

    const { url, timeout, tls, body, headers, ...undiciOptions } = reqConfig;

    const signal = this.createAbortSignal(reqConfig);

    let res: Dispatcher.ResponseData;
    try {
      res = await request(requestUrl, {
        ...undiciOptions,
        body: requestBody,
        headers: requestHeaders,
        dispatcher,
        signal,
      });
    } finally {
      /** Close only if it's a dispatcher created by this service.*/
      if (!reqConfig.dispatcher && dispatcher) {
        if (!this.config.pool && !this.dispatcher) {
          await dispatcher.close();
        }
      }
    }

    return this.handleResponse<TBody, TRaw>(res, reqConfig);
  }

  private createAbortSignal(
    config: UndiciRequestConfig,
  ): AbortSignal | undefined {
    const { timeout, signal: userSignal } = config;

    const timeoutValue = timeout ?? this.config.timeout;
    if (!timeoutValue && !userSignal) {
      return;
    }

    const signals: AbortSignal[] = [
      ...timeoutValue ? [AbortSignal.timeout(timeoutValue)] : [],
      ...userSignal ? [userSignal] : [],
    ];

    return signals.length === 1
      ? signals[0]
      : AbortSignal.any(signals);
  }

  /**
   * Dispatcher selection logic:
   * 1. If a custom dispatcher was provided via constructor (`this.dispatcher`),
   *    always use it.
   * 2. If pooling is disabled (`config.pool = false`), create a new Agent
   *    for each request unless a custom dispatcher is set.
   *    This is useful when the same origin needs to be accessed with different
   *    TLS configurations or when you explicitly want to avoid connection
   *    reuse.
   * 3. If pooling is enabled (`config.pool = true`), reuse a Pool per origin
   *    to take advantage of TCP connection reuse.
   *    Please note that pools are cached by origin and created only once
   *    per origin using the TLS config from the first request to that origin.
   *    Subsequent requests to the same origin with different TLS settings will
   *    reuse the existing pool, ignoring their per-request tls
   */
  private getDispatcher(
    url: URL,
    config: UndiciRequestConfig,
  ): Dispatcher | RetryAgent {
    if (!this.config.pool || this.dispatcher) {
      return this.createDispatcher(config);
    }

    const origin = url.origin;
    if (this.pools.has(origin)) {
      return this.pools.get(origin)!;
    }

    const poolOptions = typeof this.config.pool === 'boolean'
      ? {}
      : this.config.pool;

    this.logger.debug(`Creating new connection pool for origin: ${origin}`);
    const pool: Dispatcher = this.wrapDispatcher(
      new Pool(origin, {
        ...poolOptions,
        connect: config.tls ?? this.config.tls,
      }),
    );

    this.pools.set(origin, pool);

    return pool;
  }

  /**
   * Creates a new Agent without storing it globally unless a custom dispatcher
   * was set in the constructor.
   *
   * Important: When `pool = false` and no custom dispatcher is set, this will
   * create a fresh Agent on every call. This ensures that no TCP/TLS session
   * state is shared between requests, which can be critical when:
   * - Connecting to the same host with different TLS certificates/SNI.
   * - Avoiding persistent connections for security-sensitive endpoints.
   */
  private createDispatcher(config: UndiciRequestConfig): Dispatcher {
    if (this.dispatcher) {
      return this.dispatcher;
    }

    return this.wrapDispatcher(
      new Agent({ connect: config.tls ?? this.config.tls }),
    );
  }

  private wrapDispatcher(dispatcher: Dispatcher): Dispatcher {
    if (dispatcher instanceof RetryAgent || !this.config.retry) {
      return dispatcher;
    }

    const retryOptions = typeof this.config.retry === 'boolean'
      ? {}
      : this.config.retry;

    return new RetryAgent(dispatcher, retryOptions);
  }

  private buildUrl(path: string): URL {
    if (/^http(s)?:\/\//.test(path)) {
      return new URL(path);
    }

    if (!this.config.baseURL) {
      throw new Error('baseURL is not set, but a relative path was provided.');
    }

    const url = [
      this.config.baseURL.replace(/\/$/, ''),
      path.replace(/^\//, ''),
    ].join('/');

    return new URL(url);
  }

  private async handleResponse<TBody, TRaw>(
    response: Dispatcher.ResponseData,
    reqConfig: UndiciRequestConfig,
  ): Promise<UndiciResponse<TBody, TRaw>> {
    const { statusCode, headers } = response;
    const interceptors = this.config.responseInterceptors ?? [];
    const hasInterceptors = interceptors.length > 0;
    const includeRawBody = reqConfig.rawBody ?? this.config.rawBody;

    let errorStrategy = reqConfig.errorStrategy ?? this.config.errorStrategy;
    errorStrategy ??= hasInterceptors ? 'intercept' : 'throw';

    let error = null;
    if (statusCode >= 400) {
      /** Don't consume the body if it will be parsed later. */
      const errorBody = !(errorStrategy === 'intercept' && hasInterceptors) &&
          errorStrategy !== 'pass'
        ? await response.body.text()
        : null;

      error = new errors.ResponseStatusCodeError(
        `Request failed with status code ${statusCode}`,
        statusCode,
        headers,
        errorBody,
      );

      if (errorStrategy === 'throw') {
        throw error;
      }
    }

    if (error && errorStrategy === 'pass') {
      return {
        ...response,
        body: response.body as TBody,
        error,
        rawBody: includeRawBody ? response.body : null,
      };
    }

    if (error && errorStrategy === 'intercept' && !hasInterceptors) {
      throw error;
    }

    const { body, rawBody } = await this.parseContent(response, reqConfig);

    /** Enrich error with rawBody */
    if (error && error.body == null) {
      error.body = rawBody;
    }

    return this.applyResponseInterceptors<UndiciResponse<TBody, TRaw>>(
      {
        ...response,
        rawBody: includeRawBody ? rawBody : null,
        body,
      },
      reqConfig,
      error,
    );
  }

  private async parseContent(
    res: Dispatcher.ResponseData,
    reqConfig: UndiciRequestConfig,
  ): Promise<Pick<UndiciResponse<any, any>, 'body' | 'rawBody'>> {
    const shouldParse = reqConfig.parse ?? this.config.parse;

    if (shouldParse === false) {
      return { body: res.body, rawBody: res.body };
    }

    if ([204, 205].includes(res.statusCode)) {
      return { body: null, rawBody: null };
    }

    const ct = this.getHeader(res.headers, 'content-type');
    const isJson = this.isJsonContentType(ct);
    const isText = ct?.startsWith('text/');

    const arrBuffer = await res.body.arrayBuffer();
    if (arrBuffer.byteLength === 0) {
      return { body: null, rawBody: arrBuffer };
    }

    if (!isText && !isJson) {
      return { body: arrBuffer, rawBody: arrBuffer };
    }

    const text = new TextDecoder('utf-8').decode(arrBuffer);
    if (!isJson) {
      return { body: text, rawBody: text };
    }

    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return { body: null, rawBody: text };
    }

    try {
      const sanitized = trimmed.charCodeAt(0) === 0xFEFF // strip BOM
        ? trimmed.slice(1)
        : trimmed;

      return { body: JSON.parse(sanitized), rawBody: text };
    } catch (e) {
      const { method, url } = reqConfig;
      this.logger.debug(
        `Failed to parse JSON from ${method} ${url.href} → ${res.statusCode}`,
        e,
      );

      throw e;
    }
  }

  private isJsonContentType(ctHeader?: string): boolean {
    const ct = ctHeader?.split(';')[0].trim().toLowerCase();

    /** Treat application/*+json as JSON as well */
    return ct === 'application/json' || !!ct?.endsWith('+json');
  }

  private getHeader(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string | undefined {
    const nameLower = name.toLowerCase();
    const val = headers[name] ??
      headers[nameLower] ??
      headers[
        Object.keys(headers).find((k) => k.toLowerCase() === nameLower) ?? ''
      ];

    return Array.isArray(val) ? val[0] : val;
  }

  private async applyRequestInterceptors(
    config: UndiciRequestConfig,
  ): Promise<UndiciRequestConfig> {
    let res = config;
    const interceptors = config.requestInterceptors ??
      this.config.requestInterceptors ?? [];

    const shallowCopy = <T extends UndiciRequestConfig>(reqConfig: T): T => {
      const headers = { ...res.headers };
      const query = { ...res.query };
      const body = this.isPlainObject(reqConfig.body)
        ? { ...reqConfig.body }
        : reqConfig.body;

      return { ...reqConfig, headers, query, body };
    };

    for (const interceptor of interceptors) {
      res = await interceptor(shallowCopy(res));
    }

    return res;
  }

  private async applyResponseInterceptors<T>(
    response: UndiciResponse<any>,
    reqConfig: UndiciRequestConfig,
    error?: any,
  ): Promise<T> {
    let res = response;
    const interceptors = reqConfig.responseInterceptors ??
      this.config.responseInterceptors ?? [];

    for (const interceptor of interceptors) {
      res = await interceptor(res, error);
    }

    return res as T;
  }

  private isPlainObject(obj: unknown): obj is Record<string, any> {
    return !!obj &&
      typeof obj === 'object' &&
      !Buffer.isBuffer(obj) &&
      !(obj instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(obj) &&
      !(obj instanceof URLSearchParams) &&
      !(obj instanceof Blob) &&
      !(typeof (obj as { pipe: any })?.pipe === 'function') &&
      !(obj instanceof FormData);
  }
}
