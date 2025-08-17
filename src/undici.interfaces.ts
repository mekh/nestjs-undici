import { ModuleMetadata, Type } from '@nestjs/common';
import { Readable } from 'stream';
import { Dispatcher, FormData, Pool, RetryHandler } from 'undici';
import BodyReadable from 'undici/types/readable';

export type UndiciRetryOptions = RetryHandler.RetryOptions;
export type UndiciPoolOptions = Pool.Options;

export type UndiciRequestBody =
  | string
  | Buffer
  | Uint8Array
  | Readable
  | null
  | FormData
  | Record<string, any>;

export type UndiciResponseBody = BodyReadable & Dispatcher.BodyMixin;

type UndiciBaseRequestOptions<TOpaque = null> =
  & { dispatcher?: Dispatcher }
  & Omit<
    Dispatcher.RequestOptions<TOpaque>,
    'origin' | 'path' | 'headers' | 'body'
  >;

interface UndiciBaseRequestConfig {
  /**
   * The default timeout in milliseconds.
   * Can be overridden by the `timeout` option in the request config.
   */
  timeout?: number;
  requestInterceptors?: UndiciRequestInterceptor[];
  /**
   * The response interceptors get an object with a parsed body if:
   * - the response has a non-empty body
   * - the response has a content-type header (text or json)
   *
   * Otherwise, the body is either null (if empty) or an ArrayBuffer.
   */
  responseInterceptors?: UndiciResponseInterceptor[];
  /**
   * The `pool` option will be ignored if the dispatcher is provided.
   * Also, `retry` will not be applied if the dispatcher is provided
   * on the request level.
   * Custom dispatchers (provided either on service or request level)
   * should be closed manually.
   */
  dispatcher?: Dispatcher;
  /**
   * Default is false.
   * Add raw body to response.
   * The raw body might be a string if there is a proper
   * content-type header set (text or json), or an ArrayBuffer otherwise
   */
  rawBody?: boolean;
  /**
   * Default is true.
   * If true - consume and parse the response body according to the content-type
   * response header. Interceptors also receive a pre-parsed body in this case.
   * Supported content-types:
   * text/.* - body and rawBody will be a string
   * application/json - body will be a JSON, rawBody will be a string
   * .*\+json.* (e.g., Application/Foo+Json; charset=UTF-8) - same as prev.
   *
   * WARNING! This prevents streaming large responses,
   * which could cause high memory usage or OOM errors for big payloads.
   * If streaming is needed (e.g., for large files), set this option to false.
   * The returned body/rawBody will be a `BodyReadable` instance in this case.
   */
  parse?: boolean;
  /**
   * Ignored if the `dispatcher` option is provided.
   */
  tls?: UndiciTlsOptions;
  /**
   * The default behavior is:
   * - `throw` if no response interceptors are provided,
   * - `intercept` if there is at least one response interceptor.
   *
   * The `pass` strategy will return the response with the `error`
   * property immediately (body and rawBody will be a `BodyReadable` instance),
   * no response interceptors will be called.
   *
   * The `throw` strategy will throw the error immediately.
   *
   * The `intercept` strategy will call the interceptors (if defined),
   * passing the response body and the error as arguments.
   * Will throw if there are no response interceptors.
   */
  errorStrategy?: 'throw' | 'pass' | 'intercept';
}

/**
 * Used in public methods - `get`, `post`, `put`, `patch`, `delete`.
 */
export interface UndiciRequestOptions
  extends UndiciBaseRequestOptions, UndiciBaseRequestConfig {
  body?: UndiciRequestBody;
  /**
   * If both signal and timeout are provided, both will be respected.
   */
  signal?: AbortSignal;
  path: string;
  headers?: Record<string, string>;
}

/**
 * Used the `request` method, request interceptors, private methods.
 */
export interface UndiciRequestConfig extends
  Omit<
    UndiciRequestOptions,
    'path'
  > {
  url: URL;
}

export interface UndiciSuccessRes<
  TBody,
  TRaw = string | Buffer | ArrayBuffer,
> extends
  Omit<
    Dispatcher.ResponseData,
    'body'
  > {
  body: TBody | null;
  rawBody: TRaw | null;
}

export interface UndiciErrorRes<
  TBody,
  TRaw = string | Buffer | ArrayBuffer,
> extends
  Omit<
    Dispatcher.ResponseData,
    'body'
  > {
  body: TBody | UndiciResponseBody | null;
  rawBody: TRaw | UndiciResponseBody | null;
  error: Error;
}

export type UndiciResponse<
  TBody,
  TRaw = string | Buffer | ArrayBuffer,
> = UndiciSuccessRes<TBody, TRaw> | UndiciErrorRes<TBody, TRaw>;

export type UndiciRequestInterceptor = (
  config: UndiciRequestConfig,
) => UndiciRequestConfig | Promise<UndiciRequestConfig>;

export type UndiciResponseInterceptor = (
  response: UndiciResponse<any>,
  error?: any,
) => UndiciResponse<any> | Promise<UndiciResponse<any>>;

type TlsKey = string | Buffer | (string | Buffer)[];

export interface UndiciTlsOptions {
  /**
   * Common Authority certificate
   */
  ca?: TlsKey;
  /**
   * Private Key certificate
   */
  key?: TlsKey;
  /**
   * Public Key certificate
   */
  cert?: TlsKey;
}

export interface UndiciConfig extends UndiciBaseRequestConfig {
  /**
   * Any valid URL address (http or https) without query params
   * @example https://example.com/api/v1/
   * @example https://example.com/
   * @example http://example.com
   */
  baseURL?: string;
  /**
   * Create a per-origin pool.
   * Ignored if the `dispatcher` option is provided.
   */
  pool?: UndiciPoolOptions | boolean;
  /**
   * Ignored if the `dispatcher` option is provided,
   * either on service or request level.
   * Otherwise, a new Agent will be created (using
   * the `tls` options, if provided) and wrapped.
   */
  retry?: UndiciRetryOptions | boolean;
}

export type UndiciOptionsGet = Omit<UndiciRequestOptions, 'method' | 'path'>;
export type UndiciOptionsPost = Omit<UndiciOptionsGet, 'body'>;
export type UndiciOptionsPut = UndiciOptionsPost;
export type UndiciOptionsPatch = UndiciOptionsPost;
export type UndiciOptionsDelete = UndiciOptionsGet;

export interface UndiciConfigFactory {
  createUndiciConfig: () => UndiciConfig;
}

export interface UndiciAsyncOptions
  extends Pick<ModuleMetadata, 'imports' | 'providers'> {
  useFactory?: (...args: any[]) => UndiciConfig | Promise<UndiciConfig>;
  useClass?: Type<UndiciConfigFactory>;
  useExisting?: Type<UndiciConfigFactory>;
  useValue?: UndiciConfig;
  inject?: any[];
  global?: boolean;
}
