import {
  UndiciRequestInterceptor,
  UndiciResponseInterceptor,
} from '../undici.interfaces';
import { RequestInterceptors } from './req.interceptors';
import { ResponseInterceptors } from './res.interceptors';

export class Interceptors {
  public static create(
    requestInterceptors: UndiciRequestInterceptor[] = [],
    responseInterceptors: UndiciResponseInterceptor[] = [],
  ): Interceptors {
    return new Interceptors(requestInterceptors, responseInterceptors);
  }

  public readonly request: RequestInterceptors;

  public readonly response: ResponseInterceptors;

  constructor(
    requestInterceptors: UndiciRequestInterceptor[],
    responseInterceptors: UndiciResponseInterceptor[],
  ) {
    this.request = new RequestInterceptors(requestInterceptors);
    this.response = new ResponseInterceptors(responseInterceptors);
  }
}
