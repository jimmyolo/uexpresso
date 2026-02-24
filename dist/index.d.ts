// https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/express/v4/index.d.ts

import e from "express";
// import uws from 'uWebSockets.js';
import uws from '@jimmyolo/uws-alma';

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
    listen(port?: number, hostname?: string, callback?: (token: any) => void): uws.TemplatedApp;
    listen(port?: number, callback?: (token: any) => void): uws.TemplatedApp;
    listen(callback?: (token: any) => void): uws.TemplatedApp;
    listen(socketPath: string, callback?: (token: any) => void): uws.TemplatedApp;

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
  export type Express = e.Express & express.Application

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
