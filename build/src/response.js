















const cookie = require("cookie");
const mime = require("mime-types");
const vary = require("vary");
const encodeUrl = require("encodeurl");
const contentDisposition = require("content-disposition");
const {
    normalizeType, stringify, deprecated, UP_PATH_REGEXP, decode,
    containsDotFile, isPreconditionFailure, isRangeFresh, NullObject,
    escapeHtml,
} = require("./utils.js");
const { Writable, pipeline } = require("stream");
const fs = require("fs");
const Path = require("path");
const statuses = require("statuses");
const { sign } = require("cookie-signature");
// events is faster at init, tseep is faster at sending events
// since we create a ton of objects and dont send a ton of events, its better to use events here
const { EventEmitter } = require("events");
const http = require("http");
const ms = require('ms');
const etag = require("etag");

const outgoingMessage = new http.OutgoingMessage();
const symbols = Object.getOwnPropertySymbols(outgoingMessage);
const kOutHeaders = symbols.find(s => s.toString() === 'Symbol(kOutHeaders)');
const HIGH_WATERMARK = 128 * 1024;

class Socket extends EventEmitter {
    constructor(response) {
        super();
        this.response = response;

        this.on('error', (err) => {
            this.emit('close');
        });
    }
    get writable() {
        return !this.response.finished;
    }

    end(body) {
        this.response.end(body);
    }

    close() {
        if (this.response.finished) {
            return;
        }
        this.response.finished = true;
        this.emit('close');
        this.response._res.close();
    }
}

module.exports = class Response extends Writable {
    #socket = null;
    #ended = false;
    // #pendingChunks = [];
    // #lastWriteChunkTime = 0;
    // #writeTimeout = null;
    #writeNext = null;
    constructor(res, req, app) {
        super();

        /** @type {import("uWebSockets.js").HttpRequest} */
        this._req = req;
        /** @type {import("uWebSockets.js").HttpResponse} */
        this._res = res;
        /** @type {ReturnType<import("./application.js")>} */
        this.app = app;

        this.headersSent = false;
        this.locals = new NullObject();
        this.finished = false;
        this.aborted = false;
        this.statusCode = 200;
        this.statusText = undefined;
        this.chunkedTransfer = true;
        this.totalSize = 0;
        this.writingChunk = false;
        this.headers = {
            'connection': 'keep-alive',
            'keep-alive': 'timeout=10'
        };
        if (this.app.get('x-powered-by')) {
            this.headers['x-powered-by'] = 'u-expresso';
        }

        // support for node internal
        this[kOutHeaders] = new Proxy(this.headers, {
            set: (obj, prop, value) => {
                this.set(prop, value[1]);
                return true;
            },
            get: (obj, prop) => {
                return obj[prop];
            }
        });
        this.body = undefined;
        this.on('error', (err) => {
            if (this.finished) {
                return;
            }
            this._res.cork(() => {
                this._res.close();
                this.finished = true;
                this.#socket?.emit('close');
            });
        });
    }

    get socket() {
        if (this.#ended) return null;
        if (!this.#socket) {
            this.#socket = new Socket(this);
        }
        return this.#socket;
    }

    _write(chunk, encoding, callback) {
        if (this.aborted) {
            const err = new Error('Request aborted');
            err.code = 'ECONNABORTED';
            return this.destroy(err);
        }
        if (this.finished) {
            const err = new Error('Response already finished');
            return this.destroy(err);
        }

        this.writingChunk = true;
        this._res.cork(() => {
            if (!this.headersSent) {
                this.writeHead(this.statusCode);
                const statusMessage = this.statusText ?? statuses.message[this.statusCode] ?? '';
                this._res.writeStatus(`${this.statusCode} ${statusMessage}`.trim());
                this.writeHeaders(typeof chunk === 'string');
            }

            if (!Buffer.isBuffer(chunk) && !(chunk instanceof ArrayBuffer)) {
                chunk = Buffer.from(chunk);
            }

            if (this.chunkedTransfer) {
                this.#writeChunked(chunk, callback);
            } else {
                this.#writeBuffered(chunk, callback);
            }
        });
    }

    #writeChunked(chunk, callback) {
        const ok = this._res.write(chunk);
        if(!ok) {
            // in backpressure
            this.#writeNext = callback;
            this._res.onWritable(() => {
                if(this.aborted || this.finished) return true;
                const cb = this.#writeNext;
                this.#writeNext = null;
                this.writingChunk = false;
                if(cb) cb(null);
                return true;
            });
            return;
        }
        this.writingChunk = false;
        callback(null);
    }

    #writeBuffered(chunk, callback) {
        const lastOffset = this._res.getWriteOffset();
        // https://github.com/uNetworking/uWebSockets.js/blob/ff48755d2f5428973d87f166f40ede34995bee5a/src/HttpResponseWrapper.h#L320-L332
        const [ok, hasResponded] = this._res.tryEnd(chunk, this.totalSize);
        if(hasResponded) {
            super.end();
            this.finished = true;
            this.writingChunk = false;
            this.#socket?.emit('close');
            callback(null);
        } else if(!ok) {
            this._res.ab = chunk;
            this._res.abOffset = lastOffset;
            this._res.onWritable((offset) => {
                if(this.finished) return true;
                const [ok, hasResponded] = this._res.tryEnd(this._res.ab.subarray(offset - this._res.abOffset), this.totalSize);
                if(hasResponded) {
                    super.end();
                    this.finished = true;
                    this.writingChunk = false;
                    this.#socket?.emit('close');
                    callback(null);
                    return true;
                }
                if(ok) {
                    this.writingChunk = false;
                    callback(null);
                }
                return true;
            });
        } else {
            this.writingChunk = false;
            callback(null);
        }
    }
    writeHead(statusCode, statusMessage, headers) {
        this.statusCode = statusCode;
        if (typeof statusMessage === 'string') {
            this.statusText = statusMessage;
        }
        if (!headers) {
            if (!statusMessage) return this;
            headers = statusMessage;
        }
        for (let header in headers) {
            this.set(header, headers[header]);
        }
        return this;
    }
    writeHeaders(utf8) {
        for (const header in this.headers) {
            const value = this.headers[header];
            if (header === 'content-length') {
                // if content-length is set, disable chunked transfer encoding, since size is known
                this.chunkedTransfer = false;
                this.totalSize = parseInt(value);
                continue;
            }
            if (Array.isArray(value)) {
                for (let val of value) {
                    this._res.writeHeader(header, val);
                }
            } else {
                this._res.writeHeader(header, value);
            }
        }
        this.headersSent = true;
    }
    _implicitHeader() {
        // compatibility function
        // usually should send headers but this is useless for us
        this.writeHead(this.statusCode);
    }
    status(code) {
        this.statusCode = parseInt(code);
        return this;
    }
    sendStatus(code) {
        return this.status(code).type('txt').send(statuses.message[code] || String(code));
    }
    end(data, cb) {
        if (typeof data === 'function') {
            cb = data
            data = undefined
        }
        if (typeof cb !== 'function') {
            cb = undefined // silence the error?
        }

        if (this.writingChunk) {
            this.once('drain', () => {
                this.end(data, cb);
            });
            return;
        }
        if (this.finished) {
            return;
        }
        this.writeHead(this.statusCode);
        this._res.cork(() => {
            if (!this.headersSent) {
                const etagFn = this.app.get('etag fn');
                if (etagFn && data && !this.headers['etag'] && !this.req.noEtag) {
                    if (typeof data === 'string') data = Buffer.from(data);
                    this.headers['etag'] = etagFn(data);
                }
                const fresh = this.req.fresh;
                const statusMessage = this.statusText ?? statuses.message[this.statusCode] ?? '';
                this._res.writeStatus(fresh ? '304 Not Modified' : `${this.statusCode} ${statusMessage}`.trim());
                this.writeHeaders(true);
                if (fresh) {
                    this._res.end();
                    this.finished = true;
                    this.#socket?.emit('close');
                    this.emit('finish');
                    this.emit('close');
                    this.#deferExit(cb);
                    return;
                }
            }
            const contentLength = this.headers['content-length'];
            if (!data && contentLength) {
                this._res.endWithoutBody(contentLength.toString());
            } else {
                if (this.req.method === 'HEAD') {
                    const length = Buffer.byteLength(data ?? '');
                    this._res.endWithoutBody(length.toString());
                } else {
                    this._res.end(data);
                }
            }

            this.finished = true;
            this.#socket?.emit('close');
            this.#deferExit(cb);
            this.emit('finish');
            this.emit('close');
        });
        return this;
    }

    #deferExit(cb) {
        process.nextTick(async () => {
            this.#ended = true
            if (cb) {
                try {
                    await cb();
                } catch (err) {
                    console.error("uncaughtException in res.end() callback...", err)
                }
            }
        });
    }

    send(body) {
        if (this.headersSent) {
            throw new Error('Can\'t write body: Response was already sent');
        }
        const isBuffer = Buffer.isBuffer(body);
        if (body === null || body === undefined) {
            body = '';
            return this.end(body);
        } else if (typeof body === 'object' && !isBuffer) {
            return this.json(body);
        } else if (typeof body === 'number') {
            if (arguments[1]) {
                deprecated('res.send(status, body)', 'res.status(status).send(body)');
                return this.status(body).send(arguments[1]);
            } else {
                deprecated('res.send(status)', 'res.sendStatus(status)');
                if (!this.headers['content-type']) {
                    this.headers['content-type'] = 'text/plain; charset=utf-8';
                }
                return this.sendStatus(body);
            }
        } else if (typeof body === 'boolean') {
            return this.json(body);
        } else if (!isBuffer) {
            body = String(body);
        }
        if (typeof body === 'string' && !isBuffer) {
            const contentType = this.headers['content-type'];
            if (!contentType) {
                this.headers['content-type'] = 'text/html; charset=utf-8';
            } else if (!contentType.includes(';')) {
                this.headers['content-type'] += '; charset=utf-8';
            }
        } else {
            if (!this.headers['content-type']) {
                this.headers['content-type'] = 'application/octet-stream';
            }
        }
        return this.end(body);
    }

    sendFile(path, options = new NullObject(), callback) {
        if (typeof path !== 'string') {
            throw new TypeError('path argument is required to res.sendFile');
        }
        if (typeof options === 'function') {
            callback = options;
            options = new NullObject();
        }
        if (!options) options = new NullObject();
        let done = callback;
        if (!done) done = this.req.next;
        // default options
        if (typeof options.maxAge === 'string') {
            options.maxAge = ms(options.maxAge);
        } else if (typeof options.maxAge === 'undefined') {
            options.maxAge = 0;
        }
        if (typeof options.lastModified === 'undefined') {
            options.lastModified = true;
        }
        if (typeof options.cacheControl === 'undefined') {
            options.cacheControl = true;
        }
        if (typeof options.acceptRanges === 'undefined') {
            options.acceptRanges = true;
        }
        if (typeof options.etag === 'undefined') {
            options.etag = this.app.get('etag') !== false;
        }
        let etagFn = this.app.get('etag fn');
        if (options.etag && !etagFn) {
            etagFn = stat => {
                return etag(stat, { weak: true });
            }
        }

        // path checks
        if (!options.root && !Path.isAbsolute(path)) {
            this.status(500);
            return done(new Error('path must be absolute or specify root to res.sendFile'));
        }
        if (!options.skipEncodePath) {
            path = encodeURI(path);
        }
        path = decode(path);
        if (path === -1) {
            this.status(400);
            return done(new Error('Bad Request'));
        }
        if (~path.indexOf('\0')) {
            this.status(400);
            return done(new Error('Bad Request'));
        }
        if (UP_PATH_REGEXP.test(path)) {
            this.status(403);
            return done(new Error('Forbidden'));
        }
        const parts = Path.normalize(path).split(Path.sep);
        const fullpath = options.root ? Path.resolve(Path.join(options.root, path)) : path;
        if (options.root && !fullpath.startsWith(Path.resolve(options.root))) {
            this.status(403);
            return done(new Error('Forbidden'));
        }

        // dotfile checks
        if (containsDotFile(parts)) {
            switch (options.dotfiles) {
                case 'allow':
                    break;
                case 'deny':
                    this.status(403);
                    return done(new Error('Forbidden'));
                case 'ignore_files':
                    const len = parts.length;
                    if (len > 1 && parts[len - 1].startsWith('.')) {
                        this.status(404);
                        return done(new Error('Not found'));
                    }
                    break;
                case 'ignore':
                default:
                    this.status(404);
                    return done(new Error('Not found'));
            }
        }

        let stat = options._stat;
        if (!stat) {
            try {
                stat = fs.statSync(fullpath);
            } catch (err) {
                return done(err);
            }
            if (stat.isDirectory()) {
                this.status(404);
                return done(new Error(`Not found`));
            }
        }

        // headers
        if (!this.headers['content-type']) {
            const m = mime.lookup(fullpath);
            if (m) this.type(m);
            else this.type('application/octet-stream');
        }
        if (options.cacheControl) {
            this.headers['cache-control'] = `public, max-age=${options.maxAge / 1000}` + (options.immutable ? ', immutable' : '');
        }
        if (options.lastModified) {
            this.headers['last-modified'] = stat.mtime.toUTCString();
        }
        if (options.headers) {
            for (const header in options.headers) {
                this.set(header, options.headers[header]);
            }
        }
        if (options.setHeaders) {
            options.setHeaders(this, fullpath, stat);
        }

        // etag
        if (options.etag && etagFn && !this.headers['etag']) {
            this.headers['etag'] = etagFn(stat);
        }
        if (!options.etag) {
            this.req.noEtag = true;
        }

        // conditional requests
        if (isPreconditionFailure(this.req, this)) {
            this.status(412);
            return done(new Error('Precondition Failed'));
        }

        // range requests
        let offset = 0, len = stat.size, ranged = false;
        if (options.acceptRanges) {
            this.headers['accept-ranges'] = 'bytes';
            if (this.req.headers.range) {
                let ranges = this.req.range(stat.size, {
                    combine: true
                });

                // if-range
                if (!isRangeFresh(this.req, this)) {
                    ranges = -2;
                }

                if (ranges === -1) {
                    this.status(416);
                    this.headers['content-range'] = `bytes */${stat.size}`;
                    return done(new Error('Range Not Satisfiable'));
                }
                if (ranges !== -2 && ranges.length === 1) {
                    this.status(206);
                    const range = ranges[0];
                    this.headers['content-range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
                    offset = range.start;
                    len = range.end - range.start + 1;
                    ranged = true;
                }
            }
        }

        // if-modified-since, if-none-match
        if (this.req.fresh) {
            return this.end();
        }

        if (this.req.method === 'HEAD') {
            this.set('Content-Length', stat.size);
            return this.end();
        }

        // serve smaller files using workers
        if (this.app.workers.length && stat.size < 768 * 1024 && !ranged) {
            this.app.readFileWithWorker(fullpath).then((data) => {
                if (this._res.finished) {
                    return;
                }
                this.end(data);
                if (callback) callback();
            }).catch((err) => {
                if (callback) callback(err);
            });
        } else {
            // larger files or range requests are piped over response
            let opts = {
                highWaterMark: HIGH_WATERMARK
            };
            if (ranged) {
                opts.start = offset;
                opts.end = Math.max(offset, offset + len - 1);
            }
            const file = fs.createReadStream(fullpath, opts);
            this.set('Content-Length', len);
            // file.pipe(this);
            pipeline(file, this, (err) => {
                if (callback) callback(err);
            })
        }
    }
    sendfile(...args) {
        deprecated('res.sendfile()', 'res.sendFile()');
        return this.sendFile(...args);
    }
    download(path, filename, options, callback) {
        let done = callback;
        let name = filename;
        let opts = options || new NullObject();

        // support function as second or third arg
        if (typeof filename === 'function') {
            done = filename;
            name = null;
            opts = {};
        } else if (typeof options === 'function') {
            done = options;
            opts = {};
        }

        // support optional filename, where options may be in it's place
        if (typeof filename === 'object' &&
            (typeof options === 'function' || options === undefined)) {
            name = null;
            opts = filename;
        }
        if (!name) {
            name = Path.basename(path);
        }
        if (!opts.root && !Path.isAbsolute(path)) {
            opts.root = process.cwd();
        }

        this.attachment(name);
        this.sendFile(path, opts, done);
    }
    setHeader(field, value) {
        if (this.headersSent) {
            throw new Error('Cannot set headers after they are sent to the client');
        }
        if (typeof field !== 'string') {
            throw new TypeError('Header name must be a valid HTTP token');
        } else {
            field = field.toLowerCase();
            if (Array.isArray(value)) {
                this.headers[field] = value;
                return this;
            }
            this.headers[field] = String(value);
        }
        return this;
    }
    header(field, value) {
        return this.set(field, value);
    }
    set(field, value) {
        if (typeof field === 'object') {
            for (const header in field) {
                this.setHeader(header, field[header]);
            }
        } else {
            field = field.toLowerCase();
            if (field === 'content-type') {
                if (!value.includes('charset=') && (value.startsWith('text/') || value === 'application/json' || value === 'application/javascript')) {
                    value += '; charset=utf-8';
                }
            }
            this.setHeader(field, value);
        }
        return this;
    }
    get(field) {
        return this.headers[field.toLowerCase()];
    }
    getHeader(field) {
        return this.get(field);
    }
    getHeaders() {
        return this.headers;
    }
    removeHeader(field) {
        delete this.headers[field.toLowerCase()];
        return this;
    }
    append(field, value) {
        field = field.toLowerCase();
        const old = this.headers[field];
        if (old) {
            const newVal = [];
            if (Array.isArray(old)) {
                newVal.push(...old);
            } else {
                newVal.push(old);
            }
            if (Array.isArray(value)) {
                newVal.push(...value);
            } else {
                newVal.push(value);
            }
            this.headers[field] = newVal;
        } else {
            this.headers[field] = value;
        }
        return this;
    }
    render(view, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        if (!options) {
            options = {};
        } else {
            options = Object.assign({}, options);
        }
        options._locals = this.locals;
        const done = callback || ((err, str) => {
            if (err) return this.req.next(err);
            this.send(str);
        });

        this.app.render(view, options, done);
    }
    cookie(name, value, options) {
        const opt = { ...(options ?? {}) };
        let val = typeof value === 'object' ? "j:" + JSON.stringify(value) : String(value);
        if (opt.maxAge != null) {
            const maxAge = opt.maxAge - 0;
            if (!isNaN(maxAge)) {
                opt.expires = new Date(Date.now() + maxAge);
                opt.maxAge = Math.floor(maxAge / 1000);
            }
        }
        if (opt.signed) {
            val = 's:' + sign(val, this.req.secret);
        }

        if (opt.path == null) {
            opt.path = '/';
        }

        this.append('Set-Cookie', cookie.stringifySetCookie(name, val, opt));
        return this;
    }
    clearCookie(name, options) {
        const opts = { path: '/', ...options, expires: new Date(1) };
        delete opts.maxAge;
        return this.cookie(name, '', opts);
    }
    attachment(filename) {
        if(filename) {
            this.type(Path.extname(filename));
        }
        this.set('Content-Disposition', contentDisposition(filename));
        return this;
    }
    format(object) {
        const keys = Object.keys(object).filter(v => v !== 'default');
        const key = keys.length > 0 ? this.req.accepts(keys) : false;

        this.vary('Accept');

        if (key) {
            this.set('Content-Type', normalizeType(key).value);
            object[key](this.req, this, this.req.next);
        } else if (object.default) {
            object.default(this.req, this, this.req.next);
        } else {
            const err = new Error('Not Acceptable');
            err.status = err.statusCode = 406;
            this.req.next(err);
        }

        return this;
    }
    json(body) {
        if(arguments.length === 2) {
            if(typeof arguments[1] === 'number') {
                deprecated('res.json(body, status)', 'res.status(status).json(body)');
                this.statusCode = arguments[1];
            } else {
                deprecated('res.json(status, body)', 'res.status(status).json(body)');
                this.statusCode = arguments[0];
                body = arguments[1];
            }
        }

        if(!this.headers['content-type']) {
            this.headers['content-type'] = 'application/json; charset=utf-8';
        }
        const settings = this.app.settings;
        const jsonEscape = settings['json escape'];
        const replacer = settings['json replacer'];
        const spaces = settings['json spaces'];
        if (!replacer && !spaces && !jsonEscape) {
            return this.end(JSON.stringify(body));
        }
        return this.end(stringify(body, replacer, spaces, jsonEscape));
    }
    jsonp(object) {
        if(arguments.length === 2) {
            if(typeof arguments[1] === 'number') {
                deprecated('res.jsonp(body, status)', 'res.status(status).jsonp(body)');
                this.statusCode = arguments[1];
            } else {
                deprecated('res.jsonp(status, body)', 'res.status(status).jsonp(body)');
                this.statusCode = arguments[0];
                object = arguments[1];
            }
        }

        let callback = this.req.query[this.app.get('jsonp callback name')];
        let body = stringify(object, this.app.get('json replacer'), this.app.get('json spaces'), this.app.get('json escape'));

        if(!this.headers['content-type']) {
            this.set('X-Content-Type-Options', 'nosniff');
            this.headers['content-type'] = 'application/json; charset=utf-8';
        }

        if(Array.isArray(callback)) {
            callback = callback[0];
        }

        if(typeof callback === 'string' && callback.length !== 0) {
            this.set('X-Content-Type-Options', 'nosniff');
            this.headers['content-type'] = 'text/javascript; charset=utf-8';

            callback = callback.replace(/[^\[\]\w$.]/g, '');

            if(body === undefined) {
                body = '';
            } else if(typeof body === 'string') {
                // replace chars not allowed in JavaScript that are in JSON
                body = body
                    .replace(/\u2028/g, '\\u2028')
                    .replace(/\u2029/g, '\\u2029')
            }
            body = '/**/ typeof ' + callback + ' === \'function\' && ' + callback + '(' + body + ');';
        }

        return this.end(body ?? '');
    }
    links(links) {
        let link = this.get('Link') || '';
        if(link) link += ', ';
        return this.set('Link', link + Object.keys(links).map(function(rel){
            return '<' + links[rel] + '>; rel="' + rel + '"';
        }).join(', '));
    }
    location(path) {
        if (path === 'back') {
            path = this.req.get('Referrer');
            if (!path) path = this.req.get('Referer');
            if (!path) path = '/';
        }
        this.headers['location'] = encodeUrl(path);
        return this;
    }
    redirect(status, url, forceHtml = false) {
        if(arguments.length === 2) {
            if(typeof arguments[0] === 'number') {
                status = arguments[0];
                url = arguments[1];
            } else {
                deprecated('res.redirect(url, status)', 'res.redirect(status, url)');
                status = arguments[1];
                url = arguments[0];
            }
        } else if(arguments.length < 2) {
            url = status;
            status = 302;
        }
        this.location(url);
        this.status(status);
        const address = this.get('Location');
        let body;
        // Support text/{plain,html} by default
        if (forceHtml) {
            this.set('Content-Type', 'text/html; charset=UTF-8');
            body =
                '<!DOCTYPE html>\n' +
                '<html lang="en">\n' +
                '<head>\n' +
                '<meta charset="utf-8">\n' +
                '<title>Redirecting</title>\n' +
                '</head>\n' +
                '<body>\n' +
                `<pre>Redirecting to ${escapeHtml(address)}</pre>\n` +
                '</body>\n' +
                '</html>\n';
        } else {
            this.format({
                text: () => {
                    this.set('Content-Type', 'text/plain; charset=UTF-8');
                    body = `${statuses.message[status]}. Redirecting to ${address}`;
                },
                html: () => {
                    this.set('Content-Type', 'text/html; charset=UTF-8');
                    body = `<p>${statuses.message[status]}. Redirecting to ${escapeHtml(address)}</p>`;
                },
                default: () => {
                    this.set('Content-Type', 'text/plain; charset=UTF-8');
                    body = '';
                }
            });
        }
        if (this.req.method === 'HEAD') {
            this.end();
        } else {
            this.end(body);
        }
    }

    type(type) {
        let ct = type.indexOf('/') === -1
            ? (mime.contentType(type) || 'application/octet-stream')
            : type;

        return this.set('content-type', ct);
    }
    contentType = this.type;

    vary(field) {
        // checks for back-compat
        if (!field || (Array.isArray(field) && !field.length)) {
            deprecated('res.vary(): Provide a field name');
            return this;
        }
        vary(this, field);
        return this;
    }

    get connection() {
        return this.socket;
    }

    get writableFinished() {
        return this.finished;
    }

    get writableEnded() {
        return this.writableFinished;
    }
}
