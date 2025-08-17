import {
  UndiciRequestInterceptor,
  UndiciResponseInterceptor,
} from '../undici.interfaces';

type Interceptor = UndiciRequestInterceptor | UndiciResponseInterceptor;
type InterceptorArgs<T extends Interceptor> = Parameters<T>;
type InterceptorRes<T extends Interceptor> = ReturnType<T>;

export abstract class AbstractInterceptors<T extends Interceptor> {
  protected interceptors: T[];

  constructor(interceptors: T[]) {
    this.interceptors = interceptors;
  }

  public abstract apply(
    ...args: InterceptorArgs<T>
  ): Promise<InterceptorRes<T>>;

  public get length(): number {
    return this.interceptors.length;
  }

  public add(interceptor: T): T {
    this.interceptors.push(interceptor);

    return interceptor;
  }

  public remove(interceptor: T): void {
    const idx = this.interceptors.indexOf(interceptor);
    if (idx === -1) {
      return;
    }

    this.interceptors.splice(idx, 1);
  }
}
