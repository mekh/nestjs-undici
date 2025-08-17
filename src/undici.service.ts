import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Dispatcher, errors, request } from 'undici';
import { Interceptors } from './interceptors';
import { DispatchersManager } from './services';

import { UNDICI_CLIENT_OPTIONS } from './undici.constants';
import {
  Exact,
  UndiciBaseRequestOptions,
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
import * as utils from './utils';

type Raw = string | Buffer | ArrayBuffer;

const CONTENT_TYPE_HEADER = 'content-type';
const CONTENT_TYPE_JSON = 'application/json';

@Injectable()
export class UndiciService implements OnModuleDestroy {
  private readonly logger = new Logger(UndiciService.name);

  public readonly interceptors: Interceptors;

  public readonly dispatchers: DispatchersManager;

  constructor(
    @Inject(UNDICI_CLIENT_OPTIONS) private readonly config: UndiciConfig,
  ) {
    this.interceptors = Interceptors.create(
      this.config.requestInterceptors,
      this.config.responseInterceptors,
    );

    this.dispatchers = new DispatchersManager(this.config);
  }

  async onModuleDestroy(): Promise<void> {
    await this.dispatchers.closeAll();
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

    const reqConfig = await this.interceptors.request.apply({
      ...opts,
      url: this.buildUrl(options.path),
    });

    const requestUrl = reqConfig.url;
    const {
      body: requestBody,
      headers: requestHeaders,
    } = this.createBodyAndHeaders(reqConfig);

    const signal = this.createAbortSignal(reqConfig);
    const dispatcher = this.dispatchers.getDispatcher(
      reqConfig.url.origin,
      reqConfig,
    );
    const requestOptions = this.cleanupConfig(reqConfig);

    let res: Dispatcher.ResponseData;
    try {
      res = await request(requestUrl, {
        ...requestOptions,
        body: requestBody,
        headers: requestHeaders,
        dispatcher,
        signal,
      });
    } finally {
      await this.dispatchers.closeIfCustom(dispatcher);
    }

    return this.handleResponse<TBody, TRaw>(res, reqConfig);
  }

  private cleanupConfig(
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
      ...undiciOptions
    } = reqConfig;

    return undiciOptions;
  }

  private createBodyAndHeaders(reqConfig: UndiciRequestConfig): {
    body: Exclude<UndiciRequestBody, Record<string, any>> | undefined;
    headers: Record<string, string>;
  } {
    const requestHeaders = { ...reqConfig.headers };

    const ct = this.getHeader(requestHeaders, CONTENT_TYPE_HEADER);
    const isJsonCt = !ct || this.isJsonContentType(ct);

    let requestBody = reqConfig.body;
    if (isJsonCt && utils.isPlainObject(requestBody)) {
      requestBody = JSON.stringify(requestBody);
      if (!ct) {
        requestHeaders[CONTENT_TYPE_HEADER] = CONTENT_TYPE_JSON;
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

    return { body: requestBody, headers: requestHeaders };
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
    const hasInterceptors = !!reqConfig.responseInterceptors?.length ||
      !!this.interceptors.response.length;
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

    return this.interceptors.response.apply<UndiciResponse<TBody, TRaw>>(
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

    const ct = this.getHeader(res.headers, CONTENT_TYPE_HEADER);
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
      return { body: JSON.parse(trimmed), rawBody: text };
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
    return ct === CONTENT_TYPE_JSON || !!ct?.endsWith('+json');
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
}
