import { Injectable } from '@nestjs/common';

import { BaseConfig } from './base.config';

@Injectable()
export class UndiciBaseConfig extends BaseConfig {
  public readonly baseURL = this.asString('UNDICI_BASE_URL');

  public readonly timeout = this.asNumber('UNDICI_TIMEOUT');

  public readonly rawBody = this.asBoolean('UNDICI_RAW_BODY');

  public readonly parse = this.asBoolean('UNDICI_RAW_PARSE');

  public readonly retry = this.asBoolean('UNDICI_RAW_RETRY');

  public readonly errorStrategy = this.asEnum(
    'UNDICI_ERROR_STRATEGY',
    ['throw', 'pass', 'intercept'],
  );
}
