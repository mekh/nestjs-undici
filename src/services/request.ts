import { Readable } from 'stream';
import { Dispatcher, FormData, request } from 'undici';

import { RequestInterceptors } from '../interceptors/req.interceptors';
import {
  Exact,
  UndiciBaseRequestOptions,
  UndiciRequestBody,
  UndiciRequestConfig,
  UndiciRequestOptions,
} from '../undici.interfaces';
import * as utils from '../utils';
import { DispatcherManager } from './dispatcher-manager';
import { Headers } from './headers';

type Body =
  | string
  | Buffer
  | Uint8Array
  | Readable
  | FormData;

interface ExecutionResult {
  req: UndiciRequestConfig;
  res: Dispatcher.ResponseData;
}

export class Request {
  public static execute(
    options: UndiciRequestOptions,
    dispatchers: DispatcherManager,
    interceptors: RequestInterceptors,
    baseURL?: string,
  ): Promise<ExecutionResult> {
    return new Request(options, dispatchers, interceptors, baseURL).execute();
  }

  constructor(
    private readonly options: UndiciRequestOptions,
    private readonly dispatchers: DispatcherManager,
    private readonly interceptors: RequestInterceptors,
    private readonly baseURL?: string,
  ) {}

  public async execute(): Promise<ExecutionResult> {
    const { path, ...opts } = this.options;
    const url = this.pathToURL(path);
    const config = await this.interceptors.apply({ ...opts, url });

    const headers = Headers.create(config.headers);
    const body = this.createBody(headers, config.body);
    const requestOptions = this.createRequestOptions(config);
    const signal = this.createAbortSignal(config.timeout, config.signal);
    const dispatcher = this.dispatchers.getDispatcher(
      config.url.origin,
      config,
    );

    let res: Dispatcher.ResponseData;
    try {
      res = await request(config.url, {
        ...requestOptions,
        headers: headers.headers,
        body,
        dispatcher,
        signal,
      });
    } finally {
      await this.dispatchers.closeIfCustom(dispatcher);
    }

    return { req: config, res };
  }

  private createBody(headers: Headers, body?: UndiciRequestBody): Body | null {
    const ct = headers.contentType;
    const isJsonCt = !ct || headers.isJson();

    let requestBody = body ?? null;
    if (isJsonCt && utils.isPlainObject(requestBody)) {
      requestBody = JSON.stringify(requestBody);
      if (!ct) {
        headers.contentType = headers.ctJson;
      }
    }

    if (utils.isPlainObject(requestBody)) {
      throw new Error(
        [
          'Request body must be a string or a Buffer.',
          `Received: ${typeof requestBody}`,
          'Please check if the content-type header is set correctly.',
          'Automatic serialization works only for JSON or empty content-types.',
        ].join(' '),
      );
    }

    return requestBody;
  }

  private createAbortSignal(
    userTimeout?: number,
    userSignal?: AbortSignal,
  ): AbortSignal | undefined {
    const timeout = userTimeout ?? this.options.timeout;
    if (!timeout && !userSignal) {
      return;
    }

    const signals: AbortSignal[] = [
      ...timeout ? [AbortSignal.timeout(timeout)] : [],
      ...userSignal ? [userSignal] : [],
    ];

    return signals.length === 1
      ? signals[0]
      : AbortSignal.any(signals);
  }

  private createRequestOptions(
    reqConfig: UndiciRequestConfig,
  ): Exact<UndiciRequestConfig, UndiciBaseRequestOptions> {
    const {
      url,
      timeout,
      responseInterceptors,
      requestInterceptors,
      dispatcher,
      rawBody,
      parse,
      tls,
      errorStrategy,
      body,
      headers,
      retry,
      ...undiciOptions
    } = reqConfig;

    return undiciOptions;
  }

  private pathToURL(path: string): URL {
    if (/^http(s)?:\/\//.test(path)) {
      return new URL(path);
    }

    if (!this.baseURL) {
      throw new Error('baseURL is not set, but a relative path was provided.');
    }

    const url = [
      this.baseURL.replace(/\/$/, ''),
      path.replace(/^\//, ''),
    ].join('/');

    return new URL(url);
  }
}
