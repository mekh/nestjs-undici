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
  public static forRoot(options: UndiciConfig): DynamicModule {
    return {
      module: UndiciModule,
      providers: [
        {
          provide: UNDICI_CLIENT_OPTIONS,
          useValue: options,
        },
        UndiciService,
      ],
      exports: [UndiciService],
    };
  }

  public static forRootAsync(options: UndiciAsyncOptions): DynamicModule {
    const configProvider = this.createOptionsProvider(options);

    return {
      module: UndiciModule,
      global: options.global,
      imports: options.imports,
      providers: [
        ...options.providers ?? [],
        configProvider,
        UndiciService,
      ],
      exports: [configProvider, UndiciService],
    };
  }

  private static createOptionsProvider(options: UndiciAsyncOptions): Provider {
    if (options.useFactory) {
      return {
        provide: UNDICI_CLIENT_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject,
      };
    }

    if (options.useClass) {
      return {
        provide: UNDICI_CLIENT_OPTIONS,
        inject: [options.useClass],
        useFactory: (config: UndiciConfigFactory) =>
          config.createUndiciConfig(),
      };
    }

    if (options.useExisting) {
      return {
        provide: UNDICI_CLIENT_OPTIONS,
        inject: [options.useExisting],
        useFactory: (config: UndiciConfigFactory) =>
          config.createUndiciConfig(),
      };
    }

    if (options.useValue) {
      return {
        provide: UNDICI_CLIENT_OPTIONS,
        useValue: options.useValue,
      };
    }

    return {
      provide: UNDICI_CLIENT_OPTIONS,
      useValue: {},
    };
  }
}
