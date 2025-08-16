export class BaseConfig {
  public get env(): Record<string, string | undefined> {
    return process.env;
  }

  public asNumber(envName: string): number | undefined {
    const env = this.env[envName];

    return env && Number(env) ? Number(env) : undefined;
  }

  public asString(envName: string): string | undefined {
    return this.env[envName];
  }

  public asBoolean(envName: string): boolean | undefined {
    const value = this.asString(envName);

    return value && ['true', 'false'].includes(value)
      ? value === 'true'
      : undefined;
  }
}
