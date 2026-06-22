// https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/express/v4/index.d.ts

import e from "express";
// import uws from 'uWebSockets.js';
import uws from '@jimmyolo/uws.js';

declare namespace express {

  export interface AppOptions {
    fsWorkers?: number;

    uwsOptions?: uws.AppOptions;
    uwsApp?: uws.TemplatedApp;
    h3?: boolean; /* uws.H3App(), http/3 still in experiment stage... */
  }

  export import json = e.json;
  export import raw = e.raw;
  export import text = e.text;
  export import static = e.static;
  export import urlencoded = e.urlencoded;

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
    ;
  export type AppBuiltInSettings = AppBuiltInBooleanSettings
    | 'env'
    | 'etag'
    | 'jsonp callback name'
    | 'json replacer'
    | 'json spaces'
    | 'query parser'
    | 'subdomain offset'
    | 'trust proxy'
    | 'views'
    | 'view engine'
    ;

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
  export interface Application extends Omit<e.Application,
      | 'listen' | 'set' | 'enable' | 'disable' | 'enabled' | 'disabled' | 'use'
      | 'on' | 'once' | 'addListener' | 'removeListener' | 'off' | 'emit'> {
    listen(port?: number, hostname?: string, callback?: () => void): this;
    listen(port?: number, callback?: () => void): this;
    listen(callback?: () => void): this;
    listen(socketPath: string, callback?: () => void): this;

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
    use: ((...handlers: e.RequestHandler[]) => this)
      & ((...handlers: RequestHandlerParams[]) => this)
      & ((path: string | RegExp | Array<string | RegExp>, ...handlers: e.RequestHandler[]) => this)
      & ((path: string | RegExp | Array<string | RegExp>, ...handlers: RequestHandlerParams[]) => this)
      & e.Application['use'];

    close(cb?:()=>void): this;
    address(): {port:number} | null;
    readonly uwsApp: uws.TemplatedApp;

    enabled<T extends AppBuiltInBooleanSettings>(setting: T): boolean;
    disabled<T extends AppBuiltInBooleanSettings>(setting: T): boolean;

    enable<T extends AppBuiltInBooleanSettings>(setting: T): this;
    disable<T extends AppBuiltInBooleanSettings>(setting: T): this;

    set<T extends AppBuiltInSettings>(
      setting: T,
      value: T extends AppBuiltInBooleanSettings ? boolean : any
    ): this;

    // Typed events. listen() reports a failed bind asynchronously via an
    // 'error' event (an Error with a `.code`, e.g. EADDRINUSE) — not a sync
    // throw and not the success callback — so consumers must `app.on('error', …)`.
    // Express narrows `on`/`once` to only the 'mount' event, hiding the generic
    // EventEmitter API. We omit the emitter methods from the base above and
    // declare them explicitly here (specific 'error'/'mount' overloads first, a
    // generic `string | symbol` fallback last so arbitrary EventEmitter usage
    // still type-checks). `extends EventEmitter` is intentionally NOT used —
    // its `prependListener` et al. conflict with express's base after the Omit.
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'mount', listener: (parent: Application) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    once(event: 'error', listener: (err: Error) => void): this;
    once(event: 'mount', listener: (parent: Application) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;
    addListener(event: 'error', listener: (err: Error) => void): this;
    addListener(event: 'mount', listener: (parent: Application) => void): this;
    addListener(event: string | symbol, listener: (...args: any[]) => void): this;
    removeListener(event: 'error', listener: (err: Error) => void): this;
    removeListener(event: 'mount', listener: (parent: Application) => void): this;
    removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
    off(event: 'error', listener: (err: Error) => void): this;
    off(event: 'mount', listener: (parent: Application) => void): this;
    off(event: string | symbol, listener: (...args: any[]) => void): this;
    emit(event: 'error', err: Error): boolean;
    emit(event: 'mount', parent: Application): boolean;
    emit(event: string | symbol, ...args: any[]): boolean;
  }

  export import CookieOptions = e.CookieOptions;
  export import Errback = e.Errback;
  export import ErrorRequestHandler = e.ErrorRequestHandler;

  // export import Express = e.Express;
  // Omit the methods that Application overrides so vanilla Express's loose
  // overloads (e.g. `set(setting: string, val: any)`) don't leak back in
  // through the intersection and defeat Application's narrowed generics.
  export type Express = Omit<e.Express,
    | 'listen' | 'set' | 'enable' | 'disable' | 'enabled' | 'disabled' | 'use'
    | 'on' | 'once' | 'addListener' | 'removeListener' | 'off' | 'emit'> & express.Application

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
  export { uws }
}

declare function express(settings?: express.AppOptions): express.Express;
export = express;
