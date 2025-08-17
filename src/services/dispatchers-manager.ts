import { Logger } from '@nestjs/common';
import { Dispatcher, Pool, RetryAgent } from 'undici';
import {
  UndiciConfig,
  UndiciPoolOptions,
  UndiciRetryOptions,
  UndiciTlsOptions,
} from '../undici.interfaces';
import { CustomAgent } from './custom-agent';

type Config = Pick<UndiciConfig, 'dispatcher' | 'pool' | 'retry' | 'tls'>;
type PoolOptions = Pick<Config, 'pool'>;
type RetryOptions = Pick<Config, 'retry'>;
type TlsOptions = Pick<Config, 'tls'>;

export class DispatchersManager {
  private readonly logger = new Logger(DispatchersManager.name);

  private readonly pools = new Map<string, Dispatcher>();

  private readonly dispatcher?: Dispatcher;

  constructor(private readonly config: Config) {
    this.dispatcher = this.config.dispatcher
      ? this.wrapDispatcher(this.config.dispatcher)
      : undefined;
  }

  /**
   * Dispatcher selection logic:
   * 1. If a custom dispatcher was provided via constructor (`this.dispatcher`),
   *    always use it.
   * 2. If pooling is disabled (`config.pool = false`), create a new Agent
   *    for each request unless a custom dispatcher is set.
   *    This is useful when the same origin needs to be accessed with different
   *    TLS configurations or when you explicitly want to avoid connection
   *    reuse.
   * 3. If pooling is enabled (`config.pool = true`), reuse a Pool per origin
   *    to take advantage of TCP connection reuse.
   *    Please note that pools are cached by origin and created only once
   *    per origin using the TLS config from the first request to that origin.
   *    Subsequent requests to the same origin with different TLS settings will
   *    reuse the existing pool, ignoring their per-request tls
   */
  public getDispatcher(
    origin: string,
    config?: Config,
  ): Dispatcher | undefined {
    if (config?.dispatcher || this.dispatcher) {
      return config?.dispatcher ?? this.dispatcher;
    }

    if (config?.pool || this.config.pool) {
      return this.getOrCreatePool(origin, config);
    }

    return this.createDispatcher(config);
  }

  public async closeAll(): Promise<void> {
    this.logger.log('Closing all connections...');
    await this.close(this.dispatcher);

    await Promise.all(
      [...this.pools.values()].map((pool) => {
        this.close(pool).catch((e) => {
          this.logger.debug('Failed to close connection pool', e);
        });
      }),
    );

    this.logger.log('All connections closed.');
  }

  public async closeCustom(dispatcher?: Dispatcher): Promise<void> {
    if (!dispatcher) {
      return;
    }

    if (dispatcher instanceof CustomAgent) {
      await this.close(dispatcher);
    }
  }

  protected async close(dispatcher?: Dispatcher): Promise<void> {
    if (dispatcher) {
      await dispatcher.close();
    }
  }

  /**
   * Creates a new CustomAgent without storing it globally
   * unless a custom dispatcher was set in the constructor.
   *
   * Important: When `pool = false` and no custom dispatcher is set, this will
   * create a fresh CustomAgent on every call. This ensures that
   * no TCP/TLS session state is shared between requests, which can be
   * critical when:
   * - Connecting to the same host with different TLS certificates/SNI.
   * - Avoiding persistent connections for security-sensitive endpoints.
   */
  protected createDispatcher(
    config?: Pick<Config, 'tls' | 'retry'>,
  ): Dispatcher | undefined {
    if (
      !config?.tls &&
      !config?.retry &&
      !this.config.tls &&
      !this.config.retry
    ) {
      return;
    }

    return this.wrapDispatcher(
      new CustomAgent({ connect: this.getTlsOpts(config) }),
      config,
    );
  }

  protected getOrCreatePool(
    origin: string,
    config?: Pick<Config, 'tls' | 'pool'>,
  ): Dispatcher {
    return this.pools.get(origin) ?? this.createPool(origin, config);
  }

  protected createPool(
    origin: string,
    config?: Pick<Config, 'tls' | 'pool' | 'retry'>,
  ): Dispatcher {
    this.logger.debug(`Creating new connection pool for origin: ${origin}`);

    const poolOptions = this.getPoolOpts(config);
    const pool = new Pool(origin, {
      ...poolOptions,
      connect: this.getTlsOpts(config),
    });

    const wrapped = this.wrapDispatcher(pool, config);
    this.pools.set(origin, wrapped);

    return wrapped;
  }

  protected wrapDispatcher(
    dispatcher: Dispatcher,
    customOpts?: RetryOptions,
  ): Dispatcher {
    if (
      dispatcher instanceof RetryAgent ||
      customOpts?.retry === false ||
      !this.config.retry
    ) {
      return dispatcher;
    }

    const retryOpts = this.getRetryOpts(customOpts);

    return new RetryAgent(dispatcher, retryOpts);
  }

  private getPoolOpts(
    customOpts?: PoolOptions,
  ): UndiciPoolOptions | undefined {
    if (typeof customOpts?.pool === 'boolean') {
      return;
    }

    if (typeof this.config.pool === 'boolean') {
      return;
    }

    return customOpts?.pool ?? this.config.pool;
  }

  private getRetryOpts(
    customOpts?: RetryOptions,
  ): UndiciRetryOptions | undefined {
    if (typeof customOpts?.retry === 'boolean') {
      return;
    }

    if (typeof this.config.retry === 'boolean') {
      return;
    }

    return customOpts?.retry ?? this.config.retry;
  }

  private getTlsOpts(
    customOpts?: TlsOptions,
  ): UndiciTlsOptions | undefined {
    return customOpts?.tls ?? this.config.tls;
  }
}
