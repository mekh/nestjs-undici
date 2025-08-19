import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';

import { Interceptors } from './interceptors';
import { DispatcherManager, Request, Response } from './services';
import { UNDICI_CLIENT_OPTIONS } from './undici.constants';
import { TypeSafety } from './undici.enum';
import {
  UndiciConfig,
  UndiciOptionsDelete,
  UndiciOptionsGet,
  UndiciOptionsPatch,
  UndiciOptionsPost,
  UndiciOptionsPut,
  UndiciRequestBody,
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

  constructor(
    @Inject(UNDICI_CLIENT_OPTIONS) private readonly config: UndiciConfig,
  ) {
    this.interceptors = Interceptors.create(
      this.config.requestInterceptors,
      this.config.responseInterceptors,
    );

    this.dispatchers = new DispatcherManager(this.config);
  }

  async onModuleDestroy(): Promise<void> {
    await this.dispatchers.closeAll();
  }

  async get<TBody, TRaw = Raw>(
    path: string,
    options?: UndiciOptionsGet,
  ): Promise<UndiciResponse<TBody, TRaw, TSafety>> {
    return this.request<TBody, TRaw>({ ...options, path, method: 'GET' });
  }

  async post<TBody, TRaw = Raw>(
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

  async put<TBody, TRaw = Raw>(
    path: string,
    body: UndiciRequestBody,
    options?: UndiciOptionsPut,
  ): Promise<UndiciResponse<TBody, TRaw, TSafety>> {
    return this.request<TBody, TRaw>({ ...options, path, method: 'PUT', body });
  }

  async patch<TBody, TRaw = Raw>(
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

  async delete<TBody, TRaw = Raw>(
    path: string,
    options?: UndiciOptionsDelete,
  ): Promise<UndiciResponse<TBody, TRaw, TSafety>> {
    return this.request<TBody, TRaw>({ ...options, path, method: 'DELETE' });
  }

  public async request<TBody, TRaw = Raw>(
    options: UndiciRequestOptions,
  ): Promise<UndiciResponse<TBody, TRaw, TSafety>> {
    const { req, res } = await Request.execute(
      options,
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
