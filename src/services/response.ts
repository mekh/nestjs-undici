import { Logger } from '@nestjs/common';
import { Dispatcher, errors } from 'undici';

import { ResponseInterceptors } from '../interceptors/res.interceptors';
import {
  UndiciConfig,
  UndiciRequestConfig,
  UndiciResponse,
} from '../undici.interfaces';
import { Headers } from './headers';

type ResponseStatusCodeError = errors.ResponseStatusCodeError;
type ErrorStrategy = NonNullable<UndiciRequestConfig['errorStrategy']>;

type RawRes = Dispatcher.ResponseData;
type RawBody = Dispatcher.ResponseData['body'] | string | ArrayBuffer;

export class Response {
  public static async handle<TBody, TRes>(
    req: UndiciRequestConfig,
    res: RawRes,
    config: UndiciConfig,
    interceptors: ResponseInterceptors,
  ): Promise<UndiciResponse<TBody, TRes>> {
    const response = new Response(req, res, config, interceptors);

    return await response.handle() as UndiciResponse<TBody, TRes>;
  }

  private readonly logger = new Logger(Response.name);

  private readonly headers: Headers;

  private readonly errorStrategy: ErrorStrategy;

  private readonly noContentStatusCodes = [204, 205];

  private error?: ResponseStatusCodeError;

  private rawBody: RawBody | null = null;

  constructor(
    private readonly req: UndiciRequestConfig,
    private readonly res: RawRes,
    private readonly config: UndiciConfig,
    private readonly interceptors: ResponseInterceptors,
  ) {
    this.headers = Headers.create(res.headers);
    this.errorStrategy = this.getErrorStrategy();
    this.rawBody = this.res.body;
  }

  private get shouldThrow(): boolean {
    return this.errorStrategy === 'throw';
  }

  private get shouldPass(): boolean {
    return this.errorStrategy === 'pass';
  }

  public async handle(): Promise<UndiciResponse<any>> {
    await this.parseError();

    if (this.error && this.shouldPass) {
      return this.formatOut(this.res.body);
    }

    const body = await this.parseBody();
    if (this.error) {
      this.error.body = this.rawBody;
    }

    return this.interceptors.apply(
      this.formatOut(body),
      this.req,
      this.error,
    );
  }

  private async parseBody(): Promise<RawBody | null> {
    const shouldParse = this.req.parse ?? this.config.parse;

    if (shouldParse === false) {
      return this.rawBody;
    }

    if (this.noContentStatusCodes.includes(this.res.statusCode)) {
      this.rawBody = null;

      return null;
    }

    this.rawBody = await this.res.body.arrayBuffer();
    if (this.rawBody.byteLength === 0) {
      return null;
    }

    const isJson = this.headers.isJson();
    const isText = this.headers.isText();
    if (!isText && !isJson) {
      return this.rawBody;
    }

    this.rawBody = new TextDecoder('utf-8').decode(this.rawBody);
    if (!isJson) {
      return this.rawBody;
    }

    const trimmed = this.rawBody.trim();
    if (trimmed.length === 0) {
      return null;
    }

    try {
      return JSON.parse(trimmed);
    } catch (e) {
      const { method, url } = this.req;
      this.logger.debug(
        `JSON parse failed: ${method} ${url.href} → ${this.res.statusCode}`,
        e,
      );

      throw e;
    }
  }

  private async parseError(): Promise<void> {
    if (this.res.statusCode < 400) {
      return;
    }

    this.error = new errors.ResponseStatusCodeError(
      `Request failed with status code ${this.res.statusCode}`,
      this.res.statusCode,
      this.res.headers,
      null,
    );

    if (this.shouldThrow) {
      this.error.body = await this.res.body.text();

      throw this.error;
    }
  }

  private getErrorStrategy(): ErrorStrategy {
    const hasInterceptors = !!this.req.responseInterceptors?.length ||
      !!this.interceptors.length;

    let strategy = this.req.errorStrategy ?? this.config.errorStrategy;

    strategy = strategy === 'intercept' && !hasInterceptors
      ? 'throw'
      : strategy;

    return strategy ?? (hasInterceptors ? 'intercept' : 'throw');
  }

  private formatOut(body: any): UndiciResponse<any> {
    const rawBody = this.config.rawBody ? this.rawBody : null;

    return {
      ...this.res,
      body,
      rawBody,
      error: this.error as ResponseStatusCodeError,
    };
  }
}
