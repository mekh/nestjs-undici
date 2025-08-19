import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Headers, RequestInfo, RequestInit, fetch } from 'undici';

import { Interceptors } from './interceptors';
import { DispatcherManager, Request, Response } from './services';
import { UNDICI_CLIENT_OPTIONS } from './undici.constants';
import { TypeSafety } from './undici.enum';
import {
  Exact,
  UndiciConfig,
  UndiciOptionsDelete,
  UndiciOptionsGet,
  UndiciOptionsPatch,
  UndiciOptionsPost,
  UndiciOptionsPut,
  UndiciRequestBody,
  UndiciRequestDefaults,
  UndiciRequestOptions,
  UndiciResponse,
} from './undici.interfaces';

type Raw = string | Buffer | ArrayBuffer;

@Injectable()
export class UndiciService<
  TSafety extends TypeSafety = TypeSafety.GUARDED,
> implements OnModuleDestroy {
  public readonly interceptors: Interceptors;

  public readonly dispatchers: DispatcherManager;

  public readonly defaults: Exact<UndiciConfig, UndiciRequestDefaults>;

  constructor(
    @Inject(UNDICI_CLIENT_OPTIONS) private readonly config: UndiciConfig,
  ) {
    this.interceptors = Interceptors.create(
      this.config.requestInterceptors,
      this.config.responseInterceptors,
    );

    this.dispatchers = new DispatcherManager(this.config);
    const { dispatcher, pool, baseURL, retry, ...defaultConfig } = this.config;

    this.defaults = defaultConfig;
  }

  async onModuleDestroy(): Promise<void> {
    await this.dispatchers.closeAll();
  }

  public async get<TBody, TRaw = Raw>(
    path: string,
    options?: UndiciOptionsGet,
  ): Promise<UndiciResponse<TBody, TRaw, TSafety>> {
    return this.request<TBody, TRaw>({ ...options, path, method: 'GET' });
  }

  public async post<TBody, TRaw = Raw>(
    path: string,
    body: UndiciRequestBody,
    options?: UndiciOptionsPost,
  ): Promise<UndiciResponse<TBody, TRaw, TSafety>> {
    return this.request<TBody, TRaw>({
      ...options,
      path,
      method: 'POST',
      body,
    });
  }

  public async put<TBody, TRaw = Raw>(
    path: string,
    body: UndiciRequestBody,
    options?: UndiciOptionsPut,
  ): Promise<UndiciResponse<TBody, TRaw, TSafety>> {
    return this.request<TBody, TRaw>({ ...options, path, method: 'PUT', body });
  }

  public async patch<TBody, TRaw = Raw>(
    path: string,
    body: UndiciRequestBody,
    options?: UndiciOptionsPatch,
  ): Promise<UndiciResponse<TBody, TRaw, TSafety>> {
    return this.request<TBody, TRaw>({
      ...options,
      path,
      method: 'PATCH',
      body,
    });
  }

  public async delete<TBody, TRaw = Raw>(
    path: string,
    options?: UndiciOptionsDelete,
  ): Promise<UndiciResponse<TBody, TRaw, TSafety>> {
    return this.request<TBody, TRaw>({ ...options, path, method: 'DELETE' });
  }

  public async headers(
    input: RequestInfo,
    options?: Omit<RequestInit, 'method'>,
  ): Promise<Headers> {
    const res = await fetch(input, { ...options, method: 'HEAD' });

    return res.headers;
  }

  public async request<TBody, TRaw = Raw>(
    options: UndiciRequestOptions,
  ): Promise<UndiciResponse<TBody, TRaw, TSafety>> {
    const { req, res } = await Request.execute(
      { ...this.defaults, ...options },
      this.dispatchers,
      this.interceptors.request,
      this.config.baseURL,
    );

    return Response.handle<TBody, TRaw, TSafety>(
      req,
      res,
      this.config,
      this.interceptors.response,
    );
  }
}
