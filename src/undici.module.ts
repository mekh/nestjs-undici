import { DynamicModule, Module, Provider } from '@nestjs/common';

import { UndiciBaseConfig } from './undici-config.service';
import { UNDICI_CLIENT_OPTIONS } from './undici.constants';
import {
  UndiciAsyncOptions,
  UndiciConfig,
  UndiciConfigFactory,
} from './undici.interfaces';
import { UndiciService } from './undici.service';

@Module({
  providers: [
    UndiciService,
    {
      provide: UNDICI_CLIENT_OPTIONS,
      useClass: UndiciBaseConfig,
    },
  ],
  exports: [UndiciService],
})
export class UndiciModule {
  public static forRoot(config: UndiciConfig): DynamicModule {
    return {
      module: UndiciModule,
      providers: [
        {
          provide: UNDICI_CLIENT_OPTIONS,
          inject: [UndiciBaseConfig],
          useFactory: (defaults: UndiciBaseConfig) =>
            this.mergeOptions(config, defaults),
        },
        UndiciService,
        UndiciBaseConfig,
      ],
      exports: [UndiciService],
    };
  }

  public static forRootAsync(options: UndiciAsyncOptions): DynamicModule {
    const defaults = new UndiciBaseConfig();
    const configProvider = this.createOptionsProvider(options, defaults);

    return {
      module: UndiciModule,
      global: options.global,
      imports: options.imports,
      providers: [
        ...options.providers ?? [],
        configProvider,
        UndiciService,
        UndiciBaseConfig,
      ],
      exports: [configProvider, UndiciService],
    };
  }

  private static createOptionsProvider(
    options: UndiciAsyncOptions,
    defaults: UndiciBaseConfig,
  ): Provider {
    if (options.useFactory) {
      return {
        provide: UNDICI_CLIENT_OPTIONS,
        useFactory: async (...args: any[]): Promise<UndiciConfig> => {
          const opts = await options.useFactory!(...args);

          return this.mergeOptions(opts, defaults);
        },
        inject: options.inject,
      };
    }

    if (options.useClass) {
      return {
        provide: UNDICI_CLIENT_OPTIONS,
        inject: [options.useClass],
        useFactory: (config: UndiciConfigFactory) =>
          this.mergeOptions(config.createUndiciConfig(), defaults),
      };
    }

    if (options.useExisting) {
      return {
        provide: UNDICI_CLIENT_OPTIONS,
        inject: [options.useExisting],
        useFactory: (config: UndiciConfigFactory) =>
          this.mergeOptions(config.createUndiciConfig(), defaults),
      };
    }

    if (options.useValue) {
      return {
        provide: UNDICI_CLIENT_OPTIONS,
        useValue: this.mergeOptions(options.useValue, defaults),
      };
    }

    return {
      provide: UNDICI_CLIENT_OPTIONS,
      useValue: defaults,
    };
  }

  private static mergeOptions(
    config: UndiciConfig,
    defaults: UndiciBaseConfig,
  ): UndiciConfig {
    return {
      ...defaults,
      ...config,
    };
  }
}
