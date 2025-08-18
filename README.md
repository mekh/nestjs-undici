# Undici (NestJS HTTP client wrapper)

A lightweight NestJS library built on top of the undici HTTP client. It provides:

- A DI-friendly UndiciService with typed helpers (get/post/put/patch/delete/request)
- Config via module options or environment variables (through UndiciBaseConfig)
- Automatic JSON serialization for request bodies and JSON/text/ArrayBuffer parsing for responses
- Request/Response interceptors pipeline
- Error handling strategies: throw | pass | intercept
- Connection pooling per origin, optional retry, and TLS configuration
- Graceful shutdown: closes dispatcher and connection pools on module destroy
- When pooling is disabled and no custom dispatcher is provided, per-request Agents are created and automatically closed after the request finishes

## Table of contents

- [Quick overview](#quick-overview)
- [Installation and compatibility](#installation-and-compatibility)
- [Getting started](#getting-started)
  - [Registering the module](#registering-the-module)
  - [Using the service](#using-the-service)
  - [Multipart and FormData](#multipart-and-formdata)
- [Configuration](#configuration)
  - [Environment variables](#environment-variables)
  - [Pooling and dispatcher](#pooling-and-dispatcher)
  - [Retry](#retry)
  - [TLS](#tls)
  - [Parsing and streaming](#parsing-and-streaming)
  - [Error strategies](#error-strategies)
  - [Interceptors](#interceptors)
  - [Per-request overrides](#per-request-overrides)
- [API reference](#api-reference)
  - [UndiciModule](#undicimodule)
  - [UndiciService](#undiciservice)
  - [Types and interfaces](#types-and-interfaces)
- [Testing](#testing)
  - [What is covered by unit tests](#what-is-covered-by-unit-tests)
  - [How to run tests](#how-to-run-tests)
- [Troubleshooting and best practices](#troubleshooting-and-best-practices)
- [License](#license)

## Quick overview

This library wraps undici to offer a clean NestJS integration. You can:

- Configure globally via module options (forRoot/forRootAsync) or rely on env variables via UndiciBaseConfig (default provider).
- Send HTTP requests with helpers and a single request() method for full control.
- Choose between automatic response parsing or streaming large payloads.
- Attach request/response interceptors for cross-cutting concerns (auth, logging, error shaping, etc.).
- Control connection pooling and retries using undici primitives (Pool, Agent, RetryAgent).

## Installation and compatibility

- Runtime: Node.js compatible with undici ^7 (see package.json for the exact version used by the repo)
- Framework: NestJS ^11
- Install: `pnpm add @toxicoder/nestjs-undici` (or npm/yarn). The undici runtime is included as a dependency of this package; NestJS is a peer dependency.

## Getting started

### Registering the module

You can use environment variables out of the box by importing the module directly:

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { UndiciModule } from '@toxicoder/nestjs-undici';

@Module({
  imports: [UndiciModule],
})
export class AppModule {}
```

Or provide options explicitly:

```ts
import { Module } from '@nestjs/common';
import { UndiciModule } from '@toxicoder/nestjs-undici';

@Module({
  imports: [
    UndiciModule.forRoot({
      baseURL: 'https://api.example.com/',
      timeout: 5000,
      parse: true,
      rawBody: false,
      pool: true, // enable per-origin pooling
      retry: { retries: 2 }, // wrap dispatcher with RetryAgent
    }),
  ],
})
export class AppModule {}
```

Async options are supported as well (factory, class, existing):

```ts
UndiciModule.forRootAsync({
  global: true,
  useFactory: async () => ({
    baseURL: process.env.API_BASE_URL,
    timeout: 3000,
    parse: true,
  }),
});
```

### Using the service

Inject UndiciService and call helpers:

```ts
import { Injectable } from '@nestjs/common';
import { UndiciService } from '@toxicoder/nestjs-undici';

@Injectable()
export class FooService {
  constructor(private readonly http: UndiciService) {}

  async getUser(id: string) {
    const res = await this.http.get<{ id: string; name: string }>(
      `/users/${id}`,
    );
    if (res.statusCode >= 400) {
      // With default error strategy ('throw'), you would not see this branch
    }
    return res.body; // typed body or null
  }

  async createUser(dto: { name: string }) {
    // JSON is auto-serialized when content-type is JSON or not set
    const res = await this.http.post<{ id: string }>(`/users`, dto);
    return res.body;
  }
}
```

To stream large payloads set parse to false (globally or per-request) and use the raw readable body:

```ts
const res = await this.http.get(`/large-file`, {
  /* parse is global; override via service config if needed */
});
// With parse=false at config level → res.body is BodyReadable
// Pipe it to a stream if necessary
```

### Multipart and FormData

- Use only the FormData provided by this library: import it from `@toxicoder/nestjs-undici`.
  This re-exports undici's FormData implementation and ensures correct behavior with undici.
- Do NOT set `Content-Type` (or `Content-Length`) headers manually when sending FormData.
  When you pass undici's FormData as the request body, undici will automatically set
  the correct `multipart/form-data; boundary=...` header and compute lengths when possible.

Example:

```ts
import { Injectable } from '@nestjs/common';
import { FormData, UndiciService } from '@toxicoder/nestjs-undici';

@Injectable()
export class UploadService {
  constructor(private readonly http: UndiciService) {}

  async uploadAvatar(userId: string, bytes: Buffer) {
    const fd = new FormData();
    fd.append('userId', userId);
    // If Blob is available (Node >= 18), wrap the Buffer and optionally set type
    const file = new Blob([bytes], { type: 'image/png' });
    fd.append('file', file, 'avatar.png');

    // Do not set Content-Type manually — undici handles it for FormData
    const res = await this.http.post<{ ok: boolean }>(`/upload`, fd);
    return res.body;
  }
}
```

## Configuration

Configuration can be provided in three ways:

1. Via UndiciModule.forRoot(options)
2. Via UndiciModule.forRootAsync(options)
3. Via environment variables using the built-in UndiciBaseConfig (default provider when importing UndiciModule without forRoot/Async)

The full set of options is described by the UndiciConfig interface (see [Types and interfaces](#types-and-interfaces)).

### Environment variables

If you rely on UndiciBaseConfig, the following env variables are read:

| Variable              | Type                                    | Default                                                             | Description                                                                                  |
| --------------------- | --------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| UNDICI_BASE_URL       | string                                  | none                                                                | Base URL used to resolve relative request paths. If not set, relative paths are not allowed. |
| UNDICI_TIMEOUT        | number (ms)                             | none                                                                | Default request timeout. Can be overridden per-request via `timeout`.                        |
| UNDICI_RAW_BODY       | boolean                                 | false                                                               | When true, include `rawBody` in the response.                                                |
| UNDICI_RAW_PARSE      | boolean                                 | true                                                                | When false, do not consume/parse the response (enables streaming).                           |
| UNDICI_RAW_RETRY      | boolean                                 | false                                                               | When true, enables wrapping dispatcher with RetryAgent using default options.                |
| UNDICI_ERROR_STRATEGY | enum ('throw' \| 'pass' \| 'intercept') | 'throw' unless response interceptors are present (then 'intercept') | Controls error handling (see [Error strategies](#error-strategies)).                         |

Notes:

- UndiciBaseConfig (extends BaseConfig) maps string envs to typed values using `asString`, `asNumber`, `asBoolean`, `asEnum`.
- When an env var is missing, the respective option is undefined and normal defaults apply (e.g., `parse` defaults to true at runtime unless overridden).
- If pooling is enabled without explicit options (either via env or code), the pool uses `{ connections: 10 }` by default.
- If retry is enabled without explicit options (either via env or code), it uses `{ throwOnError: false }` by default. Set `throwOnError: true` to force throwing regardless of `errorStrategy`.

### Pooling and dispatcher

Dispatcher selection logic inside the service:

- If a custom `dispatcher` is provided in the service config (module options), it is always used and will be wrapped by `RetryAgent` when `retry` is enabled.
- If a custom `dispatcher` is provided per request (via request options), it is used as-is and is not wrapped. You are responsible for its lifecycle.
- If `pool` is `false`, a new `Agent` is created per request (no connection reuse). This is useful when connecting to the same origin with different TLS configs or when avoiding persistent connections. These transient Agents are automatically closed after the request completes.
- If `pool` is `true`, a `Pool` is created and cached per origin. The TLS config used for the first request to an origin is reused for subsequent requests to the same origin. When pooling is enabled but you don't provide explicit pool options, the default is `{ connections: 10 }`.
- On module destroy, the service-level dispatcher and all created pools are closed. Per-request custom dispatchers are not closed by the service.

### Retry

Set `retry` to:

- `true` to enable undici's `RetryAgent` with default retry options
- a concrete `UndiciRetryOptions` object to configure retries
- `false` (default) to disable retry wrapping

Defaults and behavior:

- When `retry` is enabled without explicit options, the default is `{ throwOnError: false }`.
- When `throwOnError` is `false`, whether an error is thrown or handled depends on your `errorStrategy` (see below).
- When `throwOnError` is `true`, the retry agent will throw on request/connection failure regardless of the configured `errorStrategy`.
- Providing a custom dispatcher per request bypasses retry wrapping for that request.

### TLS

You can provide TLS options (ca, key, cert). They are applied to the Agent/Pool creation when no custom dispatcher is supplied:

```ts
import { readFileSync } from 'node:fs';

UndiciModule.forRoot({
  baseURL: 'https://secure.example.com',
  tls: {
    ca: readFileSync('ca.pem'),
    cert: readFileSync('cert.pem'),
    key: readFileSync('key.pem'),
  },
});
```

### Parsing and streaming

- `parse: true` (default): consumes and parses the response body according to the `content-type` header.
  - `text/*` → body and rawBody are strings
  - `application/json` and `*+json` → body is JSON (parsed object), rawBody is the original string
  - Unknown/binary content-types → body and rawBody are `ArrayBuffer`
  - Status 204/205 → both `body` and `rawBody` are `null`
- `parse: false`: the service returns the undici `BodyReadable` without consumption/parsing (streaming mode). Interceptors receive the raw stream.

You can control `parse` globally or per request.

### Error strategies

- `throw` (default unless response interceptors exist): throws `ResponseStatusCodeError` for HTTP status >= 400. The error body is consumed if parsing would not happen later.
- `pass`: returns the response with an `error` property; `body` is the raw stream and `rawBody` is either the same stream (when `rawBody=true`) or `null`.
- `intercept`: calls response interceptors with the parsed body and the error; if there are no interceptors, the error is thrown.

You can set the error strategy globally via module config or per-request via `errorStrategy` option.

### Interceptors

You can register interceptors globally (via module config) and manage them at runtime, or provide per-request interceptors in request options.

- Request interceptors: `UndiciRequestInterceptor` receive a shallow copy of the request config (headers, query, and plain-object body are shallow-cloned per interceptor) allowing safe mutation without leaking changes across interceptors. Non-plain bodies (Buffer, ArrayBuffer, TypedArray, URLSearchParams, FormData, stream-like) are kept by reference.
- Response interceptors: `UndiciResponseInterceptor` run in order and can transform the response and/or inspect the error. They receive the parsed body when `parse: true` is enabled, otherwise the raw stream.
- You can add and remove interceptors at runtime via the `UndiciService.interceptors` API.
- Per-request interceptors replace the global pipeline for that request.

Global (module-level) configuration example:

```ts
UndiciModule.forRoot({
  baseURL: 'https://api.example.com',
  requestInterceptors: [
    async (cfg) => ({
      ...cfg,
      headers: { ...(cfg.headers ?? {}), Authorization: `Bearer ${token}` },
    }),
  ],
  responseInterceptors: [
    async (resp, err) => {
      if (err) {
        // wrap error details
        return { ...resp, body: { error: true, data: resp.body } };
      }
      return resp;
    },
  ],
});
```

Per-request override (replaces the global interceptors for this call):

```ts
await http.get('/users', {
  requestInterceptors: [
    async (cfg) => ({
      ...cfg,
      headers: { ...(cfg.headers ?? {}), 'x-req-id': crypto.randomUUID() },
    }),
  ],
  responseInterceptors: [
    async (resp) => ({ ...resp, headers: { ...resp.headers, 'x-doc': 'ok' } }),
  ],
  errorStrategy: 'intercept',
  rawBody: true,
  parse: true,
});
```

Managing interceptors at runtime:

```ts
import { UndiciService } from '@toxicoder/nestjs-undici';

@Injectable()
class ApiService {
  constructor(private readonly http: UndiciService) {
    // Add a request interceptor dynamically
    const rq = this.http.interceptors.request.add(async (cfg) => {
      return { ...cfg, headers: { ...(cfg.headers ?? {}), 'x-runtime': '1' } };
    });

    // Add a response interceptor dynamically
    const rs = this.http.interceptors.response.add(async (res, err) => {
      if (err) { return res; // inspect error if needed
       }
      return { ...res, headers: { ...res.headers, 'x-seen': 'true' } };
    });

    // You can later remove them when no longer needed
    this.http.interceptors.request.remove(rq);
    this.http.interceptors.response.remove(rs);
  }
}
```

Notes

- The default `errorStrategy` becomes `intercept` when response interceptors are present. You can always set `errorStrategy` explicitly per request.

### Per-request overrides

Most configuration options can be overridden per request by passing an `options` object to the helper methods or to `request()`:

- headers, timeout, signal
- dispatcher (used as-is and not auto-wrapped by RetryAgent)
- rawBody (include rawBody in responses)
- parse (enable/disable auto-parsing)
- tls (per-request TLS options used when creating transient Agent/Pool)
- errorStrategy ('throw' | 'pass' | 'intercept')
- requestInterceptors / responseInterceptors (replace the global interceptors for that request)

Note: `retry` is configured at the service level. If you supply a custom dispatcher per request, retry wrapping is bypassed.

## API reference

### UndiciModule

- `UndiciModule` (default provider uses `UndiciBaseConfig`):
  - `forRoot(options: UndiciConfig): DynamicModule`
  - `forRootAsync(options: UndiciAsyncOptions): DynamicModule`

### UndiciService

Properties

- `interceptors: { request: RequestInterceptors; response: ResponseInterceptors }` — allows runtime management of interceptors (`add`/`remove`).

Methods

- `get<TBody, TRaw = string | Buffer | ArrayBuffer>(url, options?)`
- `post<TBody, TRaw = string | Buffer | ArrayBuffer>(url, body, options?)`
- `put<TBody, TRaw = string | Buffer | ArrayBuffer>(url, body, options?)`
- `patch<TBody, TRaw = string | Buffer | ArrayBuffer>(url, body, options?)`
- `delete<TBody, TRaw = string | Buffer | ArrayBuffer>(url, options?)`
- `request<TBody, TRaw>(options: UndiciRequestOptions)` — low-level method used by helpers. Provide `path` (absolute URL or relative when `baseURL` is set) and any per-request overrides: `headers`, `timeout`, `signal`, `dispatcher`, `rawBody`, `parse`, `tls`, `errorStrategy`, `requestInterceptors`, `responseInterceptors`.

Behavioral notes:

- If `headers['content-type']` is JSON or missing and body is a plain object, the body is auto-serialized to JSON and the header is set to `application/json`.
- If body is a plain object and content-type is non-JSON (e.g., text/plain), an error is thrown to prevent accidental serialization.
- Relative `url` requires `baseURL` to be set; absolute URLs are used as-is.

### Types and interfaces

- `UndiciConfig`: configuration (baseURL, timeout, interceptors, dispatcher, rawBody, parse, tls, pool, retry, errorStrategy)
- `UndiciRequestOptions`: per-request options (path, headers, body, timeout, signal, dispatcher, rawBody, parse, tls, errorStrategy, request/response interceptors). Note: `retry` is configured at service level; providing a per-request dispatcher bypasses retry wrapping.
- `UndiciRequestConfig`: internal request configuration (url, headers, body, timeout, tls, signal, and the same override options)
- `UndiciResponse<TBody, TRaw>`: response union with typed `body` and optional `rawBody` and `error`
- `UndiciRequestInterceptor`, `UndiciResponseInterceptor`
- `RequestInterceptors`, `ResponseInterceptors`, `Interceptors` (runtime classes to manage and apply interceptors)
- `UndiciTlsOptions`, `UndiciRetryOptions`
- `UndiciAsyncOptions` and `UndiciConfigFactory`

## Testing

### What is covered by unit tests

Unit tests (see tests/*.spec.ts) cover:

- JSON body serialization and header handling
- URL building with absolute/relative paths and error without baseURL
- Parsing matrix: empty body, text, application/json, *+json, application/octet-stream, and 204/205 statuses
- Malformed JSON behavior (throws and logs debug)
- Error strategies: throw, pass (with/without rawBody), intercept (with/without interceptors)
- Request interceptors cloning and modification
- Case-insensitive header lookup
- isPlainObject exclusions (Buffer, ArrayBuffer views, URLSearchParams, streams, FormData)
- AbortSignal creation (timeout only, user only, both, none)
- Dispatcher selection: Agent per request when pooling disabled; per-origin Pool caching; custom dispatcher wrapped by RetryAgent; convenience HTTP methods set method
- No double-wrapping when the dispatcher is already a RetryAgent

### How to run tests

From the repository root:

- Run unit tests:
  - Using pnpm: `pnpm exec jest -c jest.config.ts`
  - Using npx: `npx jest -c jest.config.ts`

Jest config: `jest.config.ts` (rootDir='./', testMatch='<rootDir>/tests/*.spec.ts')

## Troubleshooting and best practices

- Relative path error: Provide `baseURL` or use absolute URLs.
- Multipart uploads: Use the FormData exported by this library (`import { FormData } from '@toxicoder/nestjs-undici'`). Do not set `Content-Type` or `Content-Length` manually; undici sets the appropriate `multipart/form-data` boundary and lengths automatically when FormData is used.
- Large responses: Set `parse=false` to stream the response instead of buffering it into memory.
- Content-type and body: Avoid passing plain objects with non-JSON content-type; either set JSON content-type or convert to string/Buffer.
- Pooling and TLS: Remember that the first Pool created per origin determines TLS `connect` options used for subsequent requests to that origin.
- Error strategy `intercept`: Ensure at least one response interceptor is configured; otherwise the error will be thrown.
- Retries: When enabling `retry`, configure it appropriately to avoid retry storms.
- Shutdown: If you create long-lived pools/dispatchers, ensure `onModuleDestroy` is called (Nest will do this on application shutdown) to close connections.

## License

This project is licensed under the ISC License (see package.json).
