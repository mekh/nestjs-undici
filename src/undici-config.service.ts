import { Injectable } from '@nestjs/common';

import { BaseConfig } from './base.config';
import { UndiciConfig, UndiciErrorStrategy } from './undici.interfaces';

@Injectable()
export class UndiciBaseConfig extends BaseConfig implements UndiciConfig {
  public readonly baseURL = this.asString('UNDICI_BASE_URL');

  public readonly timeout = this.asNumber('UNDICI_TIMEOUT');

  public readonly rawBody = this.asBoolean('UNDICI_RAW_BODY') ?? false;

  public readonly parse = this.asBoolean('UNDICI_RAW_PARSE') ?? true;

  public readonly retry = this.asBoolean('UNDICI_RAW_RETRY') ?? false;

  public readonly errorStrategy: UndiciErrorStrategy =
    (this.asString('UNDICI_ERROR_STRATEGY') as
      | UndiciErrorStrategy
      | undefined) ?? 'throw';
}
