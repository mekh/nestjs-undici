import {
  UndiciRequestConfig,
  UndiciResponse,
  UndiciResponseInterceptor,
} from '../undici.interfaces';
import { AbstractInterceptors } from './abstract.interceptors';

export class ResponseInterceptors extends AbstractInterceptors<
  UndiciResponseInterceptor
> {
  public async apply<T>(
    response: UndiciResponse<any>,
    reqConfig: UndiciRequestConfig,
    error?: any,
  ): Promise<T> {
    let res = response;
    const interceptors = reqConfig.responseInterceptors ?? this.interceptors;

    for (const interceptor of interceptors) {
      res = await interceptor(res, error);
    }

    return res as T;
  }
}
