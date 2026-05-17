















const mime = require("mime-types");
const path = require("path");
const proxyaddr = require("proxy-addr");
const qs = require("qs");
const querystring = require("fast-querystring");
const etag = require("etag");
const { Stats } = require("fs");

const EMPTY_REGEX = new RegExp(``);

/** Maximum query length eligible for the fast (simple) parser */
const FAST_QUERY_MAX_LENGTH = 128;
const COMPLEX_QUERY_RE = /[\[.]|%5B|%2E/i;

function fastQueryParse(query, options) {
    if (!query) {
        return new NullObject();
    }

    // Fast path: short queries without complex syntax (arrays/nesting/dots)
    if (query.length <= FAST_QUERY_MAX_LENGTH && !COMPLEX_QUERY_RE.test(query)) {
        // [Object: null prototype] issue
        // return { ...querystring.parse(query) };
        return querystring.parse(query)
    }

    // Slow path: full-featured parser for complex queries
    // [Object: null prototype] issue
    // return { ...qs.parse(query, options) };
    return qs.parse(query, options)
}

function removeDuplicateSlashes(path) {
    return path.replace(/\/{2,}/g, '/');
}

function patternToRegex(pattern, isPrefix = false) {
    if(pattern instanceof RegExp) {
        return pattern;
    }
    if(isPrefix && pattern === '') {
        return EMPTY_REGEX;
    }

    let wildcardIndex = 0;
    let regexPattern = pattern
        .replaceAll('.', '\\.')
        .replaceAll('-', '\\-')
        .replaceAll(/(\*|\(.*?\))/g, (match) => `(?<_wc${wildcardIndex++}>${match.startsWith('(') ? match.slice(1, -1) : match.replaceAll('*', '.*')})`) // Convert * to .* and stuff in parentheses to capture group
        .replace(/\/:(\w+)(\(.+?\))?\??/g, (match, param, regex) => {
            const optional = match.endsWith('?');
            return `\\/${optional ? '?' : ''}(?<${param}>${regex ? regex + '($|\\/)' : '[^/]+'})${optional ? '?' : ''}`;
        }); // Convert :param to capture group

    return new RegExp(`^${regexPattern}${isPrefix ? '(?=$|\/)' : '$'}`);
}

const REGEX_SPECIAL_CHARS = /[*?+():{}[\]]/;

function needsConversionToRegex(pattern) {
    if (pattern instanceof RegExp) {
        return false;
    }
    if (typeof pattern !== 'string') {
        return false;
    }
    return REGEX_SPECIAL_CHARS.test(pattern);
}

const ROUTE_SPECIAL_CHARS = /[*?+(){}[\]]/;

function canBeOptimized(pattern) {
    if (pattern === '/*') {
        return false;
    }
    if (pattern instanceof RegExp) {
        return false;
    }
    if (typeof pattern !== 'string') {
        return false;
    }
    return !ROUTE_SPECIAL_CHARS.test(pattern);
}

function acceptParams(str) {
    const length = str.length;
    const colonIndex = str.indexOf(';');
    let index = colonIndex === -1 ? length : colonIndex;
    const ret = { value: str.slice(0, index).trim(), quality: 1, params: {} };

    while (index < length) {
        const splitIndex = str.indexOf('=', index);
        if (splitIndex === -1) break;

        const colonIndex = str.indexOf(';', index);
        const endIndex = colonIndex === -1 ? length : colonIndex;

        if (splitIndex > endIndex) {
            index = str.lastIndexOf(';', splitIndex - 1) + 1;
            continue;
        }

        const key = str.slice(index, splitIndex).trim();
        const value = str.slice(splitIndex + 1, endIndex).trim();

        if (key === 'q') {
            ret.quality = parseFloat(value);
        } else {
            ret.params[key] = value;
        }

        index = endIndex + 1;
    }
  
    return ret;
}

function normalizeType(type) {
    return ~type.indexOf('/') ?
        acceptParams(type) :
        { value: (mime.lookup(type) || 'application/octet-stream'), params: {} };
}

const HTML_ESCAPE_REGEX = /[<>&]/g;
const HTML_ESCAPE_MAP = {
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
};
function stringify(value, replacer, spaces, escapeHtml) {
    const json = (replacer != null || spaces)
        ? JSON.stringify(value, replacer, spaces)
        : JSON.stringify(value);

    if (!escapeHtml || typeof json !== 'string') {
        return json;
    }

    return json.replace(HTML_ESCAPE_REGEX, (c) => HTML_ESCAPE_MAP[c]);
}

const defaultSettings = {
    'jsonp callback name': 'callback',
    'env': () => process.env.NODE_ENV ?? 'development',
    'etag': 'weak',
    'etag fn': () => createETagGenerator({ weak: true }),
    'query parser': 'extended',
    'query parser fn': () => fastQueryParse,
    'subdomain offset': 2,
    'trust proxy': false,
    'views': () => path.join(process.cwd(), 'views'),
    'view cache': () => process.env.NODE_ENV === 'production',
    'x-powered-by': true,
    'case sensitive routing': true,
    'declarative responses': false
};

function compileTrust(val) {
    if (typeof val === 'function') return val;
  
    if (val === true) {
        // Support plain true/false
        return function(){ return true };
    }
  
    if (typeof val === 'number') {
        // Support trusting hop count
        return function(a, i){ return i < val };
    }
  
    if (typeof val === 'string') {
        // Support comma-separated values
        val = val.split(',')
            .map(function (v) { return v.trim() })
    }
  
    return proxyaddr.compile(val || []);
}

const shownWarnings = new Set();
function deprecated(oldMethod, newMethod, full = false) {
    const err = new Error();
    const pos = full ? err.stack.split('\n').slice(1).join('\n') : err.stack.split('\n')[3].trim().split('(').slice(1).join('(').split(')').slice(0, -1).join(')');
    if(shownWarnings.has(pos)) return;
    shownWarnings.add(pos);
    console.warn(`${new Date().toLocaleString('en-UK', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        timeZone: 'GMT',
        timeZoneName: 'short'
    })} u-express deprecated ${oldMethod}: Use ${newMethod} instead at ${pos}`);
}

function findIndexStartingFrom(arr, fn, index = 0) {
    for(let i = index, end = arr.length; i < end; i++) {
        if(fn(arr[i], i, arr)) {
            return i;
        }
    }
    return -1;
};

function decode (path) {
    try {
        return decodeURIComponent(path)
    } catch (err) {
        return -1
    }
}

const UP_PATH_REGEXP = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

function containsDotFile(parts) {
    for(let i = 0, len = parts.length; i < len; i++) {
        const part = parts[i];
        if(part.length > 1 && part[0] === '.') {
            return true;
        }
    }
  
    return false;
}

function parseTokenList(str) {
    let end = 0;
    const list = [];
    let start = 0;
  
    // gather tokens
    for (let i = 0, len = str.length; i < len; i++) {
        switch(str.charCodeAt(i)) {
            case 0x20: /*   */
                if (start === end) {
                    start = end = i + 1;
                }
                break;
            case 0x2c: /* , */
                if (start !== end) {
                    list.push(str.substring(start, end));
                }
                start = end = i + 1;
                break;
            default:
                end = i + 1;
                break;
        }
    }
  
    // final token
    if (start !== end) {
        list.push(str.substring(start, end));
    }
  
    return list;
}


function parseHttpDate(date) {
    const timestamp = date && Date.parse(date);
    return typeof timestamp === 'number' ? timestamp : NaN;
}

function isPreconditionFailure(req, res) {
    const match = req.headers['if-match'];

    // if-match
    if(match) {
        const etag = res.get('etag');
        return !etag || (match !== '*' && parseTokenList(match).every(match => {
            return match !== etag && match !== 'W/' + etag && 'W/' + match !== etag;
        }));
    }

    // if-unmodified-since
    const unmodifiedSince = parseHttpDate(req.headers['if-unmodified-since']);
    if(!isNaN(unmodifiedSince)) {
        const lastModified = parseHttpDate(res.get('Last-Modified'));
        return isNaN(lastModified) || lastModified > unmodifiedSince;
    }

    return false;
}

function createETagGenerator(options) {
    return function generateETag (body, encoding) {
        if(body instanceof Stats) {
            return etag(body, options);
        }
        const buf = !Buffer.isBuffer(body) ? Buffer.from(body, encoding) : body;
        return etag(buf, options);
    }
}

function isRangeFresh(req, res) {
    const ifRange = req.headers['if-range'];
    if(!ifRange) {
        return true;
    }

    // if-range as etag
    if(ifRange.indexOf('"') !== -1) {
        const etag = res.get('etag');
        return Boolean(etag && ifRange.indexOf(etag) !== -1);
    }

    // if-range as modified date
    const lastModified = res.get('Last-Modified');
    return parseHttpDate(lastModified) <= parseHttpDate(ifRange);
}

function escapeHtml(str) {
    const s = String(str);
    const len = s.length;
    let i = 0;

    // Fast scan: find first char that needs escaping
    for(; i < len; i++) {
        const ch = s.charCodeAt(i);
        if(ch === 0x26 || ch === 0x3C || ch === 0x3E || ch === 0x22 || ch === 0x27) {
            break;
        }
    }

    // No escaping needed
    if(i === len) return s;

    // Build escaped string from the first match onward
    let escaped = s.substring(0, i);

    for(; i < len; i++) {
        const ch = s.charCodeAt(i);
        switch(ch) {
            case 0x26: // &
                escaped += '&amp;';
                break;
            case 0x3C: // <
                escaped += '&lt;';
                break;
            case 0x3E: // >
                escaped += '&gt;';
                break;
            case 0x22: // "
                escaped += '&quot;';
                break;
            case 0x27: // '
                escaped += '&#39;';
                break;
            default:
                escaped += s.charAt(i);
                break;
        }
    }

    return escaped;
}

// fast null object
const NullObject = function() {};
NullObject.prototype = Object.create(null);

module.exports = {
    removeDuplicateSlashes,
    patternToRegex,
    needsConversionToRegex,
    acceptParams,
    normalizeType,
    stringify,
    defaultSettings,
    compileTrust,
    deprecated,
    UP_PATH_REGEXP,
    NullObject,
    decode,
    containsDotFile,
    parseTokenList,
    parseHttpDate,
    isPreconditionFailure,
    createETagGenerator,
    isRangeFresh,
    findIndexStartingFrom,
    fastQueryParse,
    canBeOptimized,
    escapeHtml,
    EMPTY_REGEX
};
