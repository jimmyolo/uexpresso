















const { patternToRegex, deprecated, NullObject } = require("./utils.js");
const accepts = require("accepts");
const typeis = require("type-is");
const parseRange = require("range-parser");
const proxyaddr = require("proxy-addr");
const { isIP } = require("node:net");
const fresh = require("fresh");
const { Readable } = require("stream");

const discardedDuplicates = new Set([
    "age", "authorization", "content-length", "content-type", "etag", "expires",
    "from", "host", "if-modified-since", "if-unmodified-since", "last-modified",
    "location", "max-forwards", "proxy-authorization", "referer", "retry-after",
    "server", "user-agent"
]);

let key = 0;

module.exports = class Request extends Readable {
    #cachedQuery = null;
    #cachedHeaders = null;
    #cachedDistinctHeaders = null;
    #rawHeadersEntries = [];
    #cachedParsedIp = null;
    #paused = false;
    // legacy fields for the buffered-stream path (kept commented for reference;
    // superseded by direct push() into the Readable internal queue):
    // #needsData = false;
    // #bufferedData = null;
    constructor(req, res, app) {
        // 64KB highWaterMark: tight per-Request memory ceiling. uWS
        // delivers chunks of 95KB–524KB (per misc/uws-pause-semantics.js),
        // so most chunks exceed HWM and trigger pause/resume — the
        // trade-off is more backpressure cycles in exchange for bounded
        // memory per slow consumer (N × 64KB ceiling vs unbounded).
        super({ highWaterMark: 64 * 1024 });

        /** @type {import("uWebSockets.js").HttpRequest} */
        this._req = req;
        /** @type {import("uWebSockets.js").HttpResponse} */
        this._res = res;

        this.readable = true;
        this._req.forEach((key, value) => {
            this.#rawHeadersEntries.push([key, value]);
        });
        this.routeCount = 0;
        this.key = key++;
        if(key > 100000) {
            key = 0;
        }
        this.app = app;
        this.urlQuery = req.getQuery() ?? '';
        if(this.urlQuery) {
            this.urlQuery = '?' + this.urlQuery;
        }
        this.originalUrl = req.getUrl() + this.urlQuery;
        this.url = this.originalUrl;
        const iq = this.url.indexOf('?');
        this.path = iq !== -1 ? this.url.substring(0, iq) : this.url;
        this.endsWithSlash = this.path[this.path.length - 1] === '/';
        this._opPath = this.path;
        this._originalPath = this.path;
        if(this.endsWithSlash && this.path !== '/' && !this.app.get('strict routing')) {
            this._opPath = this._opPath.slice(0, -1);
        }
        this.method = req.getCaseSensitiveMethod().toUpperCase();
        this._isOptions = this.method === 'OPTIONS';
        this._isHead = this.method === 'HEAD';
        this.params = new NullObject();

        this._matchedMethods = new Set();
        this._gotParams = new Set();
        this._stack = [];
        this._paramStack = [];
        this.receivedData = false;
        // reading ip is very slow in UWS, so its better to not do it unless truly needed
        if(this.app.needsIpAfterResponse || this.key < 100) {
            // if app needs ip after response, read it now because after response its not accessible
            // also read it for first 100 requests to not error
            this.rawIp = this._res.getRemoteAddress();
        }

        const additionalMethods = this.app.get('body methods');
        // skip reading body for non-POST requests
        // this makes it +10k req/sec faster
        if(
            this.method === 'POST' ||
            this.method === 'PUT' ||
            this.method === 'PATCH' || 
            (additionalMethods && additionalMethods.includes(this.method))
        ) {
            // onDataV2 over onData: same callback semantics, but maxRemainingBodyLength
            // makes the V1 API obsolete in newer uWS builds. Pre-allocation is NOT
            // applied here — chunks are pushed into the Readable internal queue and
            // consumed one by one, so a single pre-sized buffer would just add an
            // extra memcpy before the consumer reads its slice.
            this._res.onDataV2((ab, maxRemainingBodyLength) => {
                this.receivedData = true;
                const isLast = maxRemainingBodyLength === 0n;
                // If response already finished/aborted, dropping is safe and
                // necessary: any _res.pause()/resume() call after the response
                // ends throws ('HttpResponse must not be accessed after a
                // successful response'). Skipping push() also frees memory.
                if(this.#responseEnded) {
                    return;
                }
                // slice(0) copies the ArrayBuffer; uWS neuters `ab` after this callback,
                // so a Buffer.from(ab) view would become invalid for any later access.
                const chunk = Buffer.from(ab.slice(0));
                const accepted = this.push(chunk);
                // Recheck #responseEnded: push() emits 'data' synchronously to
                // flowing-mode listeners. A listener that ends the response
                // inside its handler would flip response.finished here, and
                // _res.pause() would throw with the same lifecycle error the
                // entry guard above protects against.
                if(!accepted && !isLast && !this.#responseEnded) {
                    // Readable internal queue exceeded highWaterMark. Tell uWS to
                    // stop delivering until _read() resumes us.
                    this._res.pause();
                    this.#paused = true;
                }
                if(isLast) {
                    this.push(null);
                }
            });
        } else {
            this.receivedData = true;
            this.push(null);
        }
    }

    // True once the response has been sent or the connection aborted. Any
    // _res.pause()/resume() call after this throws ('HttpResponse must not
    // be accessed after a successful response'). Use this guard at every
    // _res.* access point in this file. response.finished and .aborted are
    // maintained by Response and the onAborted handler in router.js.
    get #responseEnded() {
        return this.res?.finished || this.res?.aborted;
    }

    _read() {
        // Data is pushed eagerly from the uWS onData callback. If we paused
        // uWS for backpressure, the consumer is now ready for more — resume.
        // Guard against calling _res.resume() after the response has ended
        // (same lifecycle constraint as _res.pause()).
        if(this.#paused && !this.#responseEnded) {
            this.#paused = false;
            this._res.resume();
        }
    }

    get baseUrl() {
        let match = this._originalPath.match(patternToRegex(this._stack.join(""), true));
        return match ? match[0] : '';
    }

    set baseUrl(x) {
        return this._originalPath = x;
    }

    get #host() {
        const trust = this.app.get('trust proxy fn');
        const isTrusted = !!(trust && trust(this.connection.remoteAddress, 0));
        const rawHeader = (isTrusted && this.headers['x-forwarded-host']) || this.headers['host'];
        const rawHost = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

        if(typeof rawHost !== 'string' || rawHost.length === 0) return;

        let host = rawHost.trim();
        if(isTrusted) {
            const commaIndex = host.indexOf(',');
            if(commaIndex !== -1) {
                // Note: X-Forwarded-Host is normally only ever a
                //       single value, but this is to be safe.
                host = host.slice(0, commaIndex).trimEnd();
            }
        }

        if(!host) return;

        // IPv6 literal support
        const closeBracketIndex = host[0] === '[' ? host.indexOf(']') : -1;
        const offset = closeBracketIndex !== -1 ? closeBracketIndex + 1 : 0;
        const portIndex = host.indexOf(':', offset);

        return portIndex === -1 ? host : host.slice(0, portIndex);
    }

    get host() {
        // TODO: remove in v5
        deprecated('req.host', 'req.hostname');
        return this.hostname;
    }

    get hostname() {
        return this.#host;
    }

    get httpVersion() {
        return '1.1';
    }

    get httpVersionMajor() {
        return 1;
    }

    get httpVersionMinor() {
        return 1;
    }

    get ip() {
        const trust = this.app.get('trust proxy fn');
        if(!trust) {
            return this.parsedIp;
        }
        return proxyaddr(this, trust);
    }

    get ips() {
        const trust = this.app.get('trust proxy fn');
        if(!trust) {
            return [];
        }
        const addrs = proxyaddr.all(this, trust);
        addrs.reverse().pop();
        return addrs;
    }

    get protocol() {
        const proto = this.app.ssl ? 'https' : 'http';
        const trust = this.app.get('trust proxy fn');
        if(!trust) {
            return proto;
        }
        if(!trust(this.connection.remoteAddress, 0)) {
            return proto;
        }
        const header = this.headers['x-forwarded-proto'] || proto;
        const index = header.indexOf(',');

        return index !== -1 ? header.slice(0, index).trim() : header.trim();
    }

    set query(query) {
        return this.#cachedQuery = query;
    }
    get query() {
        if(this.#cachedQuery) {
            return this.#cachedQuery;
        }
        const qp = this.app.get('query parser fn');
        if(qp) {
            this.#cachedQuery = {...qp(this.urlQuery.slice(1))};
        } else {
            this.#cachedQuery = new NullObject();
        }
        return this.#cachedQuery;
    }

    get secure() {
        return this.protocol === 'https';
    }

    get subdomains() {
        const hostname = this.hostname;
        if(!hostname) return [];

        const offset = this.app.get('subdomain offset');
        const subdomains = !isIP(hostname)
            ? hostname.split('.').reverse()
            : [hostname];

        return subdomains.slice(offset);
    }

    get xhr() {
        const val = this.headers?.['x-requested-with'];
        if(typeof val !== 'string' || val.length === 0) return false;

        return val.toLowerCase() === 'xmlhttprequest';
    }

    get parsedIp() {
        if(this.#cachedParsedIp !== null) {
            return this.#cachedParsedIp;
        }
        const finished = this.res.finished;
        if(finished) {
            // mark app as one that needs ip after response
            this.app.needsIpAfterResponse = true;
        }
        if(!this.rawIp) {
            if(finished) {
                // fallback once
                return '127.0.0.1';
            }
            this.rawIp = this._res.getRemoteAddress();
        }
        let ip = '';
        if(this.rawIp.byteLength === 4) {
            // ipv4
            ip = new Uint8Array(this.rawIp).join('.');
        } else if(this.rawIp.byteLength === 16) {
            // ipv6
            const dv = new DataView(this.rawIp);
            for(let i = 0; i < 8; i++) {
                ip += dv.getUint16(i * 2).toString(16).padStart(4, '0');
                if(i < 7) {
                    ip += ':';
                }
            }
        } else {
            ip = undefined; // unix sockets don't have ip
        }
        this.#cachedParsedIp = ip;
        return ip;
    }

    get connection() {
        deprecated('req.connection', 'req.socket');
        return this.socket;
    }

    get socket() {
        return {
            remoteAddress: this.parsedIp,
            localPort: this.app.port,
            encrypted: this.app.ssl,
            end: (body, encodings, callback) => {
                this._res.end(data, true)
                callback && process.nextTick(callback)
            },
        };
    }

    get fresh() {
        if(this.method !== 'HEAD' && this.method !== 'GET') {
            return false;
        }
        if((this.res.statusCode >= 200 && this.res.statusCode < 300) || this.res.statusCode === 304) {
            return fresh(this.headers, {
                'etag': this.res.headers['etag'],
                'last-modified': this.res.headers['last-modified'],
            });
        }
        return false;
    }

    get stale() {
        return !this.fresh;
    }

    get(field) {
        if(!field) {
            throw new TypeError('name argument is required to req.get');
        }
        if(typeof field !== 'string') {
            throw new TypeError('name must be a string to req.get');
        }
        field = field.toLowerCase();
        if(field === 'referrer' || field === 'referer') {
            return this.headers['referrer'] || this.headers['referer'];
        }
        return this.headers[field];
    }
    header = this.get

    accepts(...types) {
        return accepts(this).types(...types);
    }

    acceptsCharsets(...charsets) {
        return accepts(this).charsets(...charsets);
    }

    acceptsEncodings(...encodings) {
        return accepts(this).encodings(...encodings);
    }
    
    acceptsLanguages(...languages) {
        return accepts(this).languages(...languages);
    }

    acceptsEncoding(...args) {
        // TODO: remove in v5
        deprecated('req.acceptsEncoding', 'req.acceptsEncodings');
        return this.acceptsEncodings(...args);
    }

    acceptsCharset(...args) {
        // TODO: remove in v5
        deprecated('req.acceptsCharset', 'req.acceptsCharsets');
        return this.acceptsCharsets(...args);
    }

    acceptsLanguage(...args) {
        // TODO: remove in v5
        deprecated('req.acceptsLanguage', 'req.acceptsLanguages');
        return this.acceptsLanguages(...args);
    }

    is(types) {
        if(Array.isArray(types)) {
            return typeis(this, types);
        }

        if(arguments.length === 1) {
            return typeis(this, [types]);
        }

        return typeis(this, [...arguments]);
    }

    param(name, defaultValue) {
        // TODO: remove in v5
        deprecated('req.param(name)', 'req.params, req.body, or req.query');

        if(name == null) return defaultValue;

        if(this.params && Object.prototype.hasOwnProperty.call(this.params, name)) {
            const value = this.params[name];
            if(value != null) return value;
        }

        if(this.body && Object.prototype.hasOwnProperty.call(this.body, name)) {
            const value = this.body[name];
            if(value != null) return value;
        }

        if(this.query && Object.prototype.hasOwnProperty.call(this.query, name)) {
            const value = this.query[name];
            if(value != null) return value;
        }

        return defaultValue;
    }

    range(size, options) {
        const range = this.headers['range'];
        if(!range) return;
        return parseRange(size, range, options);
    }

    set headers(headers) {
        this.#cachedHeaders = headers;
    }
    get headers() {
        // https://nodejs.org/api/http.html#messageheaders
        if(this.#cachedHeaders) {
            return this.#cachedHeaders;
        }
        this.#cachedHeaders = new NullObject();
        for (let index = 0, len = this.#rawHeadersEntries.length; index < len; index++) {
            let [key, value] = this.#rawHeadersEntries[index];   
            key = key.toLowerCase();
            if(this.#cachedHeaders[key]) {
                if(discardedDuplicates.has(key)) {
                    continue;
                }
                if(key === 'cookie') {
                    this.#cachedHeaders[key] += '; ' + value;
                } else if(key === 'set-cookie') {
                    this.#cachedHeaders[key].push(value);
                } else {
                    this.#cachedHeaders[key] += ', ' + value;
                }
                continue;
            }
            if(key === 'set-cookie') {
                this.#cachedHeaders[key] = [value];
            } else {
                this.#cachedHeaders[key] = value;
            }
        }
        return this.#cachedHeaders;
    }

    get headersDistinct() {
        if(this.#cachedDistinctHeaders) {
            return this.#cachedDistinctHeaders;
        }
        this.#cachedDistinctHeaders = new NullObject();
        this.#rawHeadersEntries.forEach((val) => {
            const [key, value] = val;
            if(!this.#cachedDistinctHeaders[key]) {
                this.#cachedDistinctHeaders[key] = [value];
                return;
            }
            this.#cachedDistinctHeaders[key].push(value);
        });
        return this.#cachedDistinctHeaders;
    }

    get rawHeaders() {
        const res = [];
        for (let index = 0, len = this.#rawHeadersEntries.length; index < len; index++) {
            const val = this.#rawHeadersEntries[index];
            res.push(val[0], val[1]);
        }
        return res;
    }
}
