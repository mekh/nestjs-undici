import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';

import { Interceptors } from './interceptors';
import { DispatcherManager, Request, Response } from './services';
import { UNDICI_CLIENT_OPTIONS } from './undici.constants';
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
export class UndiciService implements OnModuleDestroy {
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
    const { req, res } = await Request.execute(
      options,
      this.dispatchers,
      this.interceptors.request,
      this.config.baseURL,
    );

    return Response.handle(
      req,
      res,
      this.config,
      this.interceptors.response,
    );
  }
}
