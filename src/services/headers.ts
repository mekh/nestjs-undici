import { IncomingHttpHeaders } from 'undici/types/header';

export class Headers {
  public static create(headers?: IncomingHttpHeaders): Headers {
    return new Headers(headers);
  }

  public readonly ctHeader = 'content-type';

  public readonly ctJson = 'application/json';

  public readonly ctJsonPattern = /.*\+json$/i;

  public readonly ctTextPattern = /^text\/.*/i;

  public readonly headers: IncomingHttpHeaders;

  constructor(headers?: IncomingHttpHeaders) {
    this.headers = { ...headers };
  }

  public get contentType(): string | undefined {
    return this.get(this.ctHeader)?.toLowerCase();
  }

  public set contentType(value: string) {
    this.set(this.ctHeader, value);
  }

  public set(name: string, value: string): void {
    this.headers[name] = value.toLowerCase();
  }

  public get(name: string): string | undefined {
    const nameLower = name.toLowerCase();
    let val = this.headers[name] ?? this.headers[nameLower];

    if (!val) {
      const key = Object
        .keys(this.headers)
        .find((k) => k.toLowerCase() === nameLower);

      val = key !== undefined ? this.headers[key] : val;
    }

    return Array.isArray(val) ? val[0] : val;
  }

  public isJson(): boolean {
    const ct = this.contentType?.split(';')[0].trim().toLowerCase();

    return ct === this.ctJson || !!ct?.match(this.ctJsonPattern);
  }

  public isText(): boolean {
    return !!this.contentType?.match(this.ctTextPattern);
  }
}
