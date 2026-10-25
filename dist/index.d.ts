// https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/express/v4/index.d.ts

import type {Worker as ClusterWorker} from 'node:cluster';
import type {Worker as ThreadsWorker} from 'node:worker_threads';

// import uws from 'uWebSockets.js';
import uws from '@jimmyolo/uws.js';
import e from 'express';

declare namespace express {
  export interface AppOptions {
    /** Alias for `fsWorkers` */
    threads?: number;
    fsWorkers?: number;

    uwsOptions?: uws.AppOptions;
    uwsApp?: uws.TemplatedApp;

    h3?: boolean /* uws.H3App(), http/3 still in experiment stage... */;
    http3?: boolean /** Alias for `h3` */;
  }

  export import json = e.json;
  export import raw = e.raw;
  export import text = e.text;
  export import static = e.static;
  export import urlencoded = e.urlencoded;

  /** @experimental Fork-only. */
  export interface MicrocacheOptions {
    /** Seconds. The first request after this runs the handler again. */
    lowerExpiry: number;
    /** Seconds, at least `lowerExpiry`. An entry is never served after this. */
    upperExpiry: number;
    /** Default 1000. The oldest entry is evicted first. */
    maxEntries?: number;
  }
  /**
   * @experimental Fork-only. Stores a GET 200 response by URL and replays it.
   * Middleware before it runs on every request; handlers after it are skipped
   * on a hit. The key is the URL alone: a request with Authorization, or a
   * response with Set-Cookie, Vary, or a private/no-store/no-cache
   * Cache-Control, is never stored. Use only on content that is the same for
   * every caller.
   */
  export function microcache(options: MicrocacheOptions): MicrocacheHandler;
  /** @experimental Fork-only. */
  export type MicrocacheHandler = e.RequestHandler & {
    /** Hits answered by uWS without running the chain. Informational. */
    readonly nativeHits: number;
  };

  /** Fork-only. */
  export interface ClusterOptions {
    /**
     * A positive integer, or `'auto'` (the default): the cores this process
     * may run on, capped by its cgroup CPU quota rounded down, at least 1. On
     * cgroup v2 the quota is the smallest `cpu.max` from the process's own
     * cgroup up to the root; on v1, the root's. More workers than cores is a
     * `'warning'`.
     */
    workers?: number | 'auto';
  }
  /** Fork-only. */
  export interface ClusterCloseOptions {
    /**
     * Milliseconds. A worker still running after this long gets `SIGTERM`,
     * and `SIGKILL` a second later if it is still running then. Without it
     * `close()` waits for as long as they take. A later `close()` sets a
     * deadline only where none is pending: one that is, its `SIGKILL`
     * included, stays where it is, even for a shorter timeout.
     */
    timeout?: number;
  }
  /**
   * Fork-only. What `express.cluster()` returns in the primary. It forks the
   * workers, replaces every one that ends, and prints nothing: listen for the
   * events.
   */
  export interface ClusterSupervisor extends NodeJS.EventEmitter {
    /**
     * Stops replacing workers and disconnects each of them. A worker ends once
     * its app is closed: by the helper when the worker callback returned it,
     * otherwise by the worker on its own `'disconnect'` event. `'close'`
     * follows the last exit; `process.exit()` is never called.
     */
    close(callback?: () => void): this;
    close(options: ClusterCloseOptions, callback?: () => void): this;

    // Specific events first, the generic fallback last, as on Application.
    /** A worker was forked, at startup or as a replacement. */
    on(event: 'fork', listener: (worker: ClusterWorker) => void): this;
    on(
      event: 'exit',
      listener: (
        worker: ClusterWorker,
        code: number | null,
        signal: NodeJS.Signals | null,
      ) => void,
    ): this;
    /**
     * Stops nothing: the platform does not spread connections, there are more
     * workers than cores, a worker could not be started, or a worker's
     * channel failed. A fork that throws gives this alone, with no `'exit'`.
     */
    on(event: 'warning', listener: (warning: Error) => void): this;
    /** `close()` was called and every worker has ended. */
    on(event: 'close', listener: () => void): this;
    on(event: string | symbol, listener: (...args: unknown[]) => void): this;
    once(event: 'fork', listener: (worker: ClusterWorker) => void): this;
    once(
      event: 'exit',
      listener: (
        worker: ClusterWorker,
        code: number | null,
        signal: NodeJS.Signals | null,
      ) => void,
    ): this;
    once(event: 'warning', listener: (warning: Error) => void): this;
    once(event: 'close', listener: () => void): this;
    once(event: string | symbol, listener: (...args: unknown[]) => void): this;
  }
  /**
   * Fork-only. What a worker callback may hand back for the helper to close:
   * an app, or anything else with a `close()` method.
   */
  export interface ClusterClosable {
    close(): unknown;
  }
  /**
   * Fork-only. Runs in each worker: builds an app, listens, and returns the
   * app, or an array of them, so that `supervisor.close()` can close it. One
   * that returns nothing has to close its own app on the process's
   * `'disconnect'` event. It may be `async`: what its promise resolves to is
   * read as the return value, and one that rejects fails the way a sync one
   * that throws does, with an uncaught exception that ends the worker, which
   * is then replaced. Any other value throws a `TypeError` in the worker.
   */
  export type ClusterWorkerCallback = () =>
    | ClusterWorkerResult
    | PromiseLike<ClusterWorkerResult>;
  /**
   * Fork-only. What a worker callback returns, or what its promise resolves
   * to. `null` is nothing, as `undefined` is.
   */
  export type ClusterWorkerResult =
    // biome-ignore lint/suspicious/noConfusingVoidType: `undefined` here would refuse a function declared to return void
    void | null | ClusterClosable | readonly ClusterClosable[];
  /**
   * Fork-only. Serves one port from several processes. The primary forks the
   * workers and gets a supervisor; each worker runs `worker`, which builds an
   * app, listens and returns it, and gets `undefined`. The helper installs no
   * signal handler and leaves `express()` and `listen()` as they are.
   */
  export function cluster(
    worker: ClusterWorkerCallback,
  ): ClusterSupervisor | undefined;
  export function cluster(
    options: ClusterOptions,
    worker: ClusterWorkerCallback,
  ): ClusterSupervisor | undefined;

  /** Fork-only. */
  export interface ThreadsOptions {
    /**
     * A positive integer, or `'auto'` (the default): the cores this process
     * may run on, capped by its cgroup CPU quota rounded down, at least 1, as
     * for `express.cluster()`. The main thread only accepts and is not
     * counted. More threads than cores is a `'warning'`.
     */
    workers?: number | 'auto';
    /** For the acceptor. With TLS, the same ones the worker apps are built with. */
    uwsOptions?: uws.AppOptions;
  }
  /** Fork-only. */
  export interface ThreadsCloseOptions {
    /**
     * Milliseconds. A thread still running after this long is told to exit,
     * which resets its connections, and is terminated a second later if it is
     * too busy to; that aborts the process where the thread is stuck inside a
     * request. Without it `close()` waits for as long as they take. A
     * later `close()` sets a deadline only where none is pending:
     * after a call that gave none, or once an earlier deadline has passed. A
     * deadline that is still pending stays where it is, even for a shorter
     * timeout.
     */
    timeout?: number;
  }
  /**
   * Fork-only. What `express.threads()` returns on the main thread. It starts
   * the worker threads, replaces every one that ends, holds the port they
   * serve, and prints nothing: listen for the events.
   */
  export interface ThreadsSupervisor extends NodeJS.EventEmitter {
    /**
     * Binds the port once every thread has handed over its app, so that no
     * connection is accepted before a thread can take it. A refused bind is an
     * `'error'` event, as it is on an app.
     */
    listen(port?: number, hostname?: string, callback?: () => void): this;
    listen(port?: number, callback?: () => void): this;
    /** The acceptor's address, `null` until it is bound. */
    address(): {address: string; family: string; port: number} | string | null;
    /**
     * Stops replacing threads, closes the listen socket and tells every thread
     * to end, which it does once its open connections have and nothing else
     * keeps it up. `'close'` follows
     * the last exit; `process.exit()` is never called. A `listen()` after it
     * throws.
     */
    close(callback?: () => void): this;
    close(options: ThreadsCloseOptions, callback?: () => void): this;

    // Specific events first, the generic fallback last, as on Application.
    /** A thread was started, at startup or as a replacement. */
    on(event: 'fork', listener: (worker: ThreadsWorker) => void): this;
    on(
      event: 'exit',
      listener: (worker: ThreadsWorker, code: number) => void,
    ): this;
    /**
     * Stops nothing: what a thread died of, an uncaught exception or a
     * callback that returned no app; a thread that could not be started, which
     * gives this alone, with no `'exit'`; or more threads than cores.
     */
    on(event: 'warning', listener: (warning: Error) => void): this;
    on(event: 'listening', listener: () => void): this;
    /** A failed bind. Thrown when nothing listens for it, as on an app. */
    on(event: 'error', listener: (err: Error) => void): this;
    /** `close()` was called and every thread has ended. */
    on(event: 'close', listener: () => void): this;
    on(event: string | symbol, listener: (...args: unknown[]) => void): this;
    once(event: 'fork', listener: (worker: ThreadsWorker) => void): this;
    once(
      event: 'exit',
      listener: (worker: ThreadsWorker, code: number) => void,
    ): this;
    once(event: 'warning', listener: (warning: Error) => void): this;
    once(event: 'listening', listener: () => void): this;
    once(event: 'error', listener: (err: Error) => void): this;
    once(event: 'close', listener: () => void): this;
    once(event: string | symbol, listener: (...args: unknown[]) => void): this;
  }
  /**
   * Fork-only. What a worker callback hands back for the helper to serve: an
   * app, which it takes the descriptor of, and closes as the thread ends.
   */
  export interface ThreadsServable {
    getDescriptor(): uws.AppDescriptor;
    readonly uwsApp: uws.TemplatedApp;
  }
  /**
   * Fork-only. Runs in each worker thread: builds an app and returns it
   * without calling `listen()`, since the main thread holds the port. It may
   * be `async`: what its promise resolves to is read as the return value. One
   * that returns no app, throws or rejects ends its thread with an uncaught
   * exception, which is a `'warning'` on the supervisor, and the thread is
   * then replaced.
   */
  export type ThreadsWorkerCallback = () =>
    | ThreadsServable
    | PromiseLike<ThreadsServable>;
  /**
   * Fork-only. Serves one port from several worker threads. The main thread
   * starts the threads on the entry file and gets a supervisor, whose
   * `listen()` binds the port; each thread runs `worker`, which builds an app
   * and returns it, and gets `undefined`. The helper installs no signal
   * handler.
   */
  export function threads(
    worker: ThreadsWorkerCallback,
  ): ThreadsSupervisor | undefined;
  export function threads(
    options: ThreadsOptions,
    worker: ThreadsWorkerCallback,
  ): ThreadsSupervisor | undefined;

  export import application = e.application;
  export import request = e.request;
  export import response = e.response;

  export import RouterOptions = e.RouterOptions;

  export type AppBuiltInBooleanSettings =
    | 'case sensitive routing'
    | 'json escape'
    | 'strict routing'
    | 'view cache'
    | 'x-powered-by'
    | 'catch async errors'
    | 'declarative responses'
    | 'route index'
    | 'header copy skip'
    | 'native routes';
  export type AppBuiltInSettings =
    | AppBuiltInBooleanSettings
    // `true` (64 MiB budget) or a number (budget in bytes) -- not boolean-only,
    // so it stays out of AppBuiltInBooleanSettings (same reason as 'trust proxy').
    | 'sendfile cache'
    | 'env'
    | 'etag'
    | 'jsonp callback name'
    | 'json replacer'
    | 'json spaces'
    | 'query parser'
    | 'subdomain offset'
    | 'trust proxy'
    | 'views'
    | 'view engine';

  // Mirrors Express's own `RequestHandlerParams` (request handler, error handler,
  // or a one-level array of either) but also admits a u-expresso `Application`
  // sub-app — which isn't assignable to vanilla `e.Application`. Used by the
  // `use` overloads so every Express shape works with sub-apps mixed in:
  // `use(mw, subApp)`, `use(errorHandler, subApp)`, `use([mw, subApp])`, etc.
  export type RequestHandlerParams =
    | e.RequestHandler
    | e.ErrorRequestHandler
    | Application
    | Array<e.RequestHandler | e.ErrorRequestHandler | Application>;

  // export import Application = e.Application;
  export interface InjectOptions {
    method?: string;
    /** Path, optionally with a query string. */
    path?: string;
    headers?: Record<string, string | number>;
    /** A Buffer or string is sent as-is; anything else is JSON-encoded. */
    body?: Buffer | string | object | null;
    /**
     * Re-dispatch up to this many redirects and return the final response.
     * Defaults to 0, which returns the redirect itself. 303 (and 301/302 from a
     * POST) continues as GET without the body; 307/308 keep both.
     */
    followRedirects?: number;
  }

  export interface InjectResponse {
    statusCode: number;
    statusMessage: string;
    /** Lowercased header names. */
    headers: Record<string, string>;
    body: Buffer;
  }

  export interface Application
    extends Omit<
      e.Application,
      | 'listen'
      | 'set'
      | 'enable'
      | 'disable'
      | 'enabled'
      | 'disabled'
      | 'use'
      | 'on'
      | 'once'
      | 'addListener'
      | 'removeListener'
      | 'off'
      | 'emit'
    > {
    listen(port?: number, hostname?: string, callback?: () => void): this;
    listen(port?: number, callback?: () => void): this;
    listen(callback?: () => void): this;
    listen(socketPath: string, callback?: () => void): this;

    // Inject a request into the routing stack, through the same route table
    // and middleware chain a served request uses. For carrying HTTP over
    // another transport (a WebSocket frame, a queue message) and for driving
    // the stack in tests without binding a port.
    inject(options?: InjectOptions): Promise<InjectResponse>;

    // Sub-app mounting. A u-expresso `Application` overrides `listen` to return
    // `this` (uWS semantics, not a Node `http.Server`), so it is NOT assignable
    // to vanilla `e.Application` — the inherited `use(path, e.Application)`
    // overload therefore rejects a u-expresso sub-app, forcing consumers to cast.
    // We omit `use` from the base above and re-expose it as variadic self-
    // overloads keyed on `RequestHandlerParams` (request/error handlers,
    // sub-apps, and one-level arrays of those), so a u-expresso sub-app mounts
    // with no cast in every Express shape — with/without a path prefix, mixed
    // with middleware or error handlers, and in nested arrays
    // (`use(subApp)`, `use('/api', subApp)`, `use('/api', mw, subApp)`,
    //  `use([mw, subApp])`).
    // ORDER MATTERS: these `=> this` overloads MUST precede `e.Application['use']`
    // in the intersection. TS resolves intersected call signatures in order, and
    // the standalone type `e.Application['use']` pins its polymorphic `this` to
    // `e.Application` (returning vanilla Express, breaking chaining like
    // `app.use(mw).uwsApp`). Listing ours first makes standard middleware
    // registration return `this`; `e.Application['use']` trails as a fallback for
    // any inherited typed-generic overload ours don't cover.
    // The first overload is keyed on the single `e.RequestHandler` type (not the
    // `RequestHandlerParams` union) so inline untyped arrows
    // (`app.use((req, res, next) => …)`) still get contextual parameter typing —
    // a union of mixed-arity callables defeats that inference. The path type is
    // `PathParams` inlined — a direct `express-serve-static-core` import is not
    // resolvable from this package under a non-flat node_modules layout.
    // Re-declaring a method with explicit `e.*` parameter types also takes it out
    // of what `tests/types-packaging.mjs` can detect: with `@types/express`
    // unreachable those params inherit an explicit error-`any` rather than no
    // type at all, which suppresses the TS7006 that fixture depends on. `get` is
    // left inherited on purpose so the check keeps a handler to bite on.
    use: ((...handlers: e.RequestHandler[]) => this) &
      ((...handlers: RequestHandlerParams[]) => this) &
      ((
        path: string | RegExp | Array<string | RegExp>,
        ...handlers: e.RequestHandler[]
      ) => this) &
      ((
        path: string | RegExp | Array<string | RegExp>,
        ...handlers: RequestHandlerParams[]
      ) => this) &
      e.Application['use'];

    close(cb?: (err?: Error) => void): this;
    address(): {address: string; family: string; port: number} | string | null;
    readonly uwsApp: uws.TemplatedApp;

    // Serving one port from several worker threads. A worker thread calls
    // getDescriptor() in place of listen() and posts the result to the thread
    // that listens, which registers it before its own listen().
    getDescriptor(): uws.AppDescriptor;
    addChildAppDescriptor(descriptor: uws.AppDescriptor): this;
    removeChildAppDescriptor(descriptor: uws.AppDescriptor): this;

    enabled<T extends AppBuiltInBooleanSettings>(setting: T): boolean;
    disabled<T extends AppBuiltInBooleanSettings>(setting: T): boolean;

    enable<T extends AppBuiltInBooleanSettings>(setting: T): this;
    disable<T extends AppBuiltInBooleanSettings>(setting: T): this;

    set<T extends AppBuiltInSettings>(
      setting: T,
      value: T extends AppBuiltInBooleanSettings ? boolean : unknown,
    ): this;

    // Typed events. listen() reports a failed bind asynchronously via an
    // 'error' event (an Error with a `.code`, e.g. EADDRINUSE) — not a sync
    // throw and not the success callback. With no 'error' listener it is thrown
    // on the next tick, as net.Server does.
    // Express narrows `on`/`once` to only the 'mount' event, hiding the generic
    // EventEmitter API. We omit the emitter methods from the base above and
    // declare them explicitly here (specific 'error'/'mount' overloads first, a
    // generic `string | symbol` fallback last so arbitrary EventEmitter usage
    // still type-checks). `extends EventEmitter` is intentionally NOT used —
    // its `prependListener` et al. conflict with express's base after the Omit.
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'mount', listener: (parent: Application) => void): this;
    on(event: string | symbol, listener: (...args: unknown[]) => void): this;
    once(event: 'error', listener: (err: Error) => void): this;
    once(event: 'mount', listener: (parent: Application) => void): this;
    once(event: string | symbol, listener: (...args: unknown[]) => void): this;
    addListener(event: 'error', listener: (err: Error) => void): this;
    addListener(event: 'mount', listener: (parent: Application) => void): this;
    addListener(
      event: string | symbol,
      listener: (...args: unknown[]) => void,
    ): this;
    removeListener(event: 'error', listener: (err: Error) => void): this;
    removeListener(
      event: 'mount',
      listener: (parent: Application) => void,
    ): this;
    removeListener(
      event: string | symbol,
      listener: (...args: unknown[]) => void,
    ): this;
    off(event: 'error', listener: (err: Error) => void): this;
    off(event: 'mount', listener: (parent: Application) => void): this;
    off(event: string | symbol, listener: (...args: unknown[]) => void): this;
    emit(event: 'error', err: Error): boolean;
    emit(event: 'mount', parent: Application): boolean;
    emit(event: string | symbol, ...args: unknown[]): boolean;
  }

  export import CookieOptions = e.CookieOptions;
  export import Errback = e.Errback;
  export import ErrorRequestHandler = e.ErrorRequestHandler;

  // export import Express = e.Express;
  // Omit the methods that Application overrides so vanilla Express's loose
  // overloads (e.g. `set(setting: string, val: unknown)`) don't leak back in
  // through the intersection and defeat Application's narrowed generics.
  export type Express = Omit<
    e.Express,
    | 'listen'
    | 'set'
    | 'enable'
    | 'disable'
    | 'enabled'
    | 'disabled'
    | 'use'
    | 'on'
    | 'once'
    | 'addListener'
    | 'removeListener'
    | 'off'
    | 'emit'
  > &
    express.Application;

  export import Handler = e.Handler;
  export import IRoute = e.IRoute;
  export import IRouter = e.IRouter;
  export import IRouterHandler = e.IRouterHandler;
  export import IRouterMatcher = e.IRouterMatcher;
  export import MediaType = e.MediaType;
  export import NextFunction = e.NextFunction;
  export import Locals = e.Locals;
  export import Request = e.Request;
  export import RequestHandler = e.RequestHandler;
  export import RequestParamHandler = e.RequestParamHandler;
  export import Response = e.Response;
  export import Router = e.Router;
  export import Send = e.Send;

  // additional uws declarations
  // https://unetworking.github.io/uWebSockets.js/generated/index.html
  export {uws};
}

// Express.Response is the augmentation point core.Response extends, so this
// reaches `res` in every handler. It also lands on vanilla express types in a
// project that loads both, where the field is undefined at runtime; optional
// keeps that honest.
declare global {
  namespace Express {
    interface Response {
      /**
       * Fork-only. `true` while a write is in flight: from the moment the
       * chunk reaches uWS until uWS accepts it without backpressure, chunked
       * or with Content-Length alike. Writes queued behind it are not accepted
       * either. Below the high-water mark `write()` returns `true` even while
       * the chunk is held, so a write was accepted only when
       * `res.write(chunk) && res.writingChunk !== true`.
       *
       * To wait, pass a callback to `write()`: it runs once the chunk is
       * accepted. `'drain'` does not fire after a `write()` that returned
       * `true`. If the client aborts, the flag stays `true` and the callback
       * never runs, so also stop on `'close'`.
       */
      writingChunk?: boolean;
    }
  }
}

declare function express(settings?: express.AppOptions): express.Express;
export = express;
