















const fs = require('fs');
const path = require('path');
const bytes = require('bytes');
const zlib = require('fast-zlib');
const typeis = require('type-is');
const querystring = require('fast-querystring');
const { AsyncResource } = require('node:async_hooks');
const { fastQueryParse, NullObject } = require('./utils.js');
const bufferPool = require('./buffer-pool.js');

function serveStatic(root, options) {
    if(!options) options = new NullObject();
    if(typeof options.index === 'undefined') options.index = 'index.html';
    if(typeof options.redirect === 'undefined') options.redirect = true;
    if(typeof options.fallthrough === 'undefined') options.fallthrough = true;
    if(typeof options.dotfiles === 'undefined') options.dotfiles = 'ignore_files';
    if(options.extensions) {
        if(typeof options.extensions !== 'string' && !Array.isArray(options.extensions)) {
            throw new Error('extensions must be a string or an array');
        }
        if(!Array.isArray(options.extensions)) {
            options.extensions = [options.extensions];
        }
        options.extensions = options.extensions.map(ext => ext.startsWith('.') ? ext.slice(1) : ext);
    }
    options.root = root;

    return (req, res, next) => {
        const iq = req.url.indexOf('?');
        let url;
        try {
            url = decodeURIComponent(iq !== -1 ? req.url.substring(0, iq) : req.url);
        } catch(e) {
            if(!options.fallthrough) {
                res.status(404);
                return next(new Error('Not found'));
            } else return next();
        }
        let _path = url;
        let fullpath = path.resolve(path.join(options.root, url));
        if(options.root && !fullpath.startsWith(path.resolve(options.root))) {
            if(!options.fallthrough) {
                res.status(403);
                return next(new Error('Forbidden'));
            } else return next();
        }

        let stat;
        try {
            stat = fs.statSync(fullpath);
        } catch(err) {
            const ext = path.extname(fullpath);
            let i = 0;
            if(ext === '' && options.extensions) {
                while(i < options.extensions.length) {
                    try {
                        stat = fs.statSync(fullpath + '.' + options.extensions[i]);
                        _path = url + '.' + options.extensions[i];
                        break;
                    } catch(err) {
                        i++;
                    }
                }
            }
            if(!stat) {
                if(!options.fallthrough) {
                    res.status(404);
                    return next(err.message);
                } else return next();
            }
        }

        if(stat.isDirectory()) {
            if(!req.endsWithSlash) {
                if(options.redirect) {
                    return res.redirect(301, req._originalPath + '/', true);
                } else {
                    if(!options.fallthrough) {
                        res.status(404);
                        return next(new Error('Not found'));
                    } else return next();
                }
            }
            if(options.index) {
                try {
                    stat = fs.statSync(path.join(fullpath, options.index));
                    _path = path.join(url, options.index);
                } catch(err) {
                    if(!options.fallthrough) {
                        res.status(404);
                        return next(new Error('Not found'));
                    } else return next();
                }
            } else {

                return next();
            }
        }

        options._stat = stat;

        return res.sendFile(_path, options, e => {
            if(e) {
                next(!options.fallthrough ? e : undefined);
            }
        });
    }
}

function createInflate(contentEncoding) {
    const encoding = (contentEncoding || 'identity').toLowerCase();
    switch(encoding) {
        case 'identity':
            return;
        case 'deflate':
            return new zlib.Inflate();
        case 'gzip':
            return new zlib.Gunzip();
        case 'br':
            return new zlib.BrotliDecompress();
        default:
            return false;
    }
}

function createBodyParser(defaultType, beforeReturn, factoryOpts) {
    // noPoolReclaim: true means the parser hands the body buffer to user code
    // (e.g. raw → req.body = buf), so we must not return the underlying Buffer
    // to the pool — the user's reference would otherwise alias future requests.
    const noPoolReclaim = factoryOpts ? factoryOpts.noPoolReclaim === true : false;
    return function(options) {
        if(typeof options !== 'object') {
            options = new NullObject();
        }
        if(typeof options.limit === 'undefined') options.limit = bytes('100kb');
        else options.limit = bytes(options.limit);

        if(typeof options.inflate === 'undefined') options.inflate = true;
        if(typeof options.type === 'undefined') options.type = defaultType;
        if(typeof options.type === 'string') {
            if(!options.type.includes("*")) {
                options.simpleType = options.type;
            }
            options.type = [options.type];
        } else if(typeof options.type !== 'function' && !Array.isArray(options.type)) {
            throw new Error('type must be a string, function or an array');
        }
        if(typeof options.defaultCharset === 'undefined') options.defaultCharset = 'utf-8';

        let additionalMethods;

        return (req, res, next) => {
            if(req.bodyRead) {
                return next();
            }

            // keep async context
            next = AsyncResource.bind(next);

            const type = req.headers['content-type'];

            if(!req.body) req.body = new NullObject();

            if(!type) {
                return next();
            }

            const length = req.headers['content-length'];
            if(length == '0') {
                return next();
            }

            if(options.simpleType) {
                const semicolonIndex = type.indexOf(';');
                const clearType = semicolonIndex !== -1 ? type.substring(0, semicolonIndex) : type;
                if(clearType !== options.simpleType) {
                    return next();
                }
            } else {
                if(typeof options.type === 'function') {
                    if(!options.type(req)) {
                        return next();
                    }
                } else {
                    if(!typeis(req, options.type)) {
                        return next();
                    }
                }
            }

            if(length && +length > options.limit) {
                return next(new Error('Request entity too large'));
            }


            // skip reading body for non-POST requests
            // this makes it +10k req/sec faster
            if (additionalMethods === undefined)
                additionalMethods = req.app.get('body methods') ?? null;
            if(
                req.method !== 'POST' &&
                req.method !== 'PUT' &&
                req.method !== 'PATCH' && 
                (!additionalMethods || !additionalMethods.includes(req.method))
            ) {
                return next();
            }

            let inflate;
            if(options.inflate) {
                inflate = createInflate(req.headers['content-encoding']);
                if(inflate === false) {
                    return next(new Error('Unsupported content encoding'));
                }
            }

            req.bodyRead = true;

            // Legacy abs[] + Buffer.concat path. Used when:
            //   - inflate is active: post-decompression size is unknown, so we
            //     can't pre-allocate based on uWS's maxRemainingBodyLength.
            //   - req.receivedData is already true: request.js's onDataV2 handler
            //     fired before this middleware ran. This happens whenever ANY
            //     async middleware sits between request arrival and body-parser
            //     (auth, logging, rate-limiting, etc. — i.e. the common case in
            //     real apps). uWS delivers chunks during the `await`, populating
            //     the Readable queue; we then read from the stream side and have
            //     no maxRemainingBodyLength hint to pre-allocate from.
            if(inflate || req.receivedData) {
                const abs = [];
                let totalSize = 0;

                function onData(buf) {
                    if(res.finished || res.aborted) return;
                    if(!Buffer.isBuffer(buf)) {
                        buf = Buffer.from(buf);
                    }
                    if(inflate) {
                        buf = inflate.process(buf);
                    }
                    abs.push(buf);
                    totalSize += buf.length;
                    if(totalSize > options.limit) {
                        return next(new Error('Request entity too large'));
                    }
                }

                function onEnd() {
                    const buf = Buffer.concat(abs);
                    if(options.verify) {
                        try {
                            options.verify(req, res, buf);
                        } catch(e) {
                            return next(e);
                        }
                    }
                    beforeReturn(req, res, next, options, buf);
                }

                if(req.receivedData) {
                    req.on('data', onData);
                    req.on('end', onEnd);
                } else {
                    req._res.onDataV2((ab, maxRemainingBodyLength) => {
                        const isLast = maxRemainingBodyLength === 0n;
                        // slice(0) detaches bytes from uWS-owned ab (neutered after this callback)
                        onData(ab.slice(0));
                        if(isLast && !res.finished && !res.aborted) {
                            onEnd();
                        }
                    });
                }
                return;
            }

            // Pool fast path: pre-allocate one Buffer sized to the announced body
            // length (chunk + maxRemainingBodyLength) and copy each chunk straight
            // into it. Replaces abs[] + Buffer.concat — halves total memcpy and
            // removes the per-chunk Buffer wrapper. Buffer comes from a size-bucketed
            // pool so repeat traffic at similar sizes reuses slabs across requests.
            //
            // Skip pool reclaim when verify is set (user callback may retain the
            // buffer) or for raw parser (req.body = buf hands the buffer to user
            // code). Reclaiming there would alias the user's reference into the
            // next request's body.
            const canReclaim = !options.verify && !noPoolReclaim;
            let buffer = null;
            let isPooled = false;
            let offset = 0;

            req._res.onDataV2((ab, maxRemainingBodyLength) => {
                if(res.finished || res.aborted) {
                    if(buffer && isPooled && canReclaim) {
                        bufferPool.release(buffer);
                        buffer = null;
                    }
                    return;
                }

                const chunkLen = ab.byteLength;

                if(buffer === null) {
                    // First chunk: uWS hints predicted total via maxRemainingBodyLength.
                    // If predicted already exceeds the limit, reject before acquiring —
                    // upfront Content-Length check at the top of the handler covers the
                    // header-present case, but this guards (a) missing Content-Length
                    // (chunked transfer) and (b) hostile clients that under-reported it.
                    const predicted = chunkLen + Number(maxRemainingBodyLength);
                    if(predicted > options.limit) {
                        return next(new Error('Request entity too large'));
                    }
                    const acquired = bufferPool.acquire(predicted);
                    buffer = acquired.buffer;
                    isPooled = acquired.pooled;
                }

                const newOffset = offset + chunkLen;
                if(newOffset > options.limit) {
                    if(isPooled && canReclaim) bufferPool.release(buffer);
                    buffer = null;
                    return next(new Error('Request entity too large'));
                }
                if(newOffset > buffer.length) {
                    // Defensive grow: maxRemainingBodyLength under-reported (e.g. chunked
                    // encoding without exact framing). Move to a larger pool buffer.
                    const grown = bufferPool.acquire(newOffset);
                    buffer.copy(grown.buffer, 0, 0, offset);
                    if(isPooled && canReclaim) bufferPool.release(buffer);
                    buffer = grown.buffer;
                    isPooled = grown.pooled;
                }

                buffer.set(new Uint8Array(ab), offset);
                offset = newOffset;

                if(maxRemainingBodyLength === 0n) {
                    if(res.finished || res.aborted) {
                        if(isPooled && canReclaim) bufferPool.release(buffer);
                        buffer = null;
                        return;
                    }
                    const body = buffer.subarray(0, offset);
                    if(options.verify) {
                        try {
                            options.verify(req, res, body);
                        } catch(e) {
                            return next(e);
                        }
                    }
                    beforeReturn(req, res, next, options, body);
                    if(isPooled && canReclaim) {
                        bufferPool.release(buffer);
                        buffer = null;
                    }
                }
            });
        }
    }
}

const json = createBodyParser('application/json', function(req, res, next, options, buf) {
    if(options.strict) {
        if(req.body && typeof req.body !== 'object') {
            return next(new Error('Invalid body'));
        }
    }
    if (buf.length === 0) {
        req.body = new NullObject();
        return next();
    }
    try {
        req.body = JSON.parse(buf.toString(), options.reviver);
    } catch(e) {
        return next(e);
    }

    next();
});

const raw = createBodyParser('application/octet-stream', function(req, res, next, options, buf) {
    req.body = buf;
    next();
}, { noPoolReclaim: true });

const text = createBodyParser('text/plain', function(req, res, next, options, buf) {
    let contentType = req.headers['content-type'];
    let charsetIndex = contentType.indexOf('charset=');
    let encoding = options.defaultCharset;
    if(charsetIndex !== -1) {
        encoding = contentType.substring(charsetIndex + 8);
        const semicolonIndex = encoding.indexOf(';');
        if(semicolonIndex !== -1) {
            encoding = encoding.substring(0, semicolonIndex);
        }
        encoding = encoding.trim().toLowerCase();
    }
    if(encoding !== 'utf-8' && encoding !== 'utf-16le' && encoding !== 'latin1') {
        return next(new Error('Unsupported charset'));
    }
    try {
        req.body = buf.toString(encoding);
    } catch(e) {
        return next(e);
    }

    next();
});

const urlencoded = createBodyParser('application/x-www-form-urlencoded', function(req, res, next, options, buf) {
    try {
        if(options.extended) {
            req.body = fastQueryParse(buf.toString(), options);
        } else {
            req.body = querystring.parse(buf.toString());
        }
    } catch(e) {
        return next(e);
    }
    next();
});

module.exports = {
    static: serveStatic,
    json,
    raw,
    text,
    urlencoded,
};
