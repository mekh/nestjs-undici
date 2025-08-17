import {
  UndiciRequestConfig,
  UndiciRequestInterceptor,
} from '../undici.interfaces';
import * as utils from '../utils';
import { AbstractInterceptors } from './abstract.interceptors';

export class RequestInterceptors extends AbstractInterceptors<
  UndiciRequestInterceptor
> {
  public async apply(
    config: UndiciRequestConfig,
  ): Promise<UndiciRequestConfig> {
    let res = config;
    const interceptors = config.requestInterceptors ?? this.interceptors;

    for (const interceptor of interceptors) {
      res = await interceptor(this.shallowCopy(res));
    }

    return res;
  }

  private shallowCopy<T extends UndiciRequestConfig>(reqConfig: T): T {
    const headers = { ...reqConfig.headers };
    const query = { ...reqConfig.query };
    const body = utils.isPlainObject(reqConfig.body)
      ? { ...reqConfig.body }
      : reqConfig.body;

    return { ...reqConfig, headers, query, body };
  }
}
