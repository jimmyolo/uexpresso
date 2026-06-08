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

  // export import Application = e.Application;
  export interface Application extends Omit<e.Application, 'listen' | 'set' | 'enable' | 'disable' | 'enabled' | 'disabled'> {
    listen(port?: number, hostname?: string, callback?: () => void): this;
    listen(port?: number, callback?: () => void): this;
    listen(callback?: () => void): this;
    listen(socketPath: string, callback?: () => void): this;

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
  }

  export import CookieOptions = e.CookieOptions;
  export import Errback = e.Errback;
  export import ErrorRequestHandler = e.ErrorRequestHandler;

  // export import Express = e.Express;
  // Omit the methods that Application overrides so vanilla Express's loose
  // overloads (e.g. `set(setting: string, val: any)`) don't leak back in
  // through the intersection and defeat Application's narrowed generics.
  export type Express = Omit<e.Express, 'listen' | 'set' | 'enable' | 'disable' | 'enabled' | 'disabled'> & express.Application

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
