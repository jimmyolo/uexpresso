# μ-expresso

☄️ Fast Express 4-compatible HTTP server, built on top of [μWebSockets.js](https://github.com/uNetworking/uWebSockets.js). Drop-in replacement for Express across the surfaces tested in `tests/` — same API, same middleware, ~4× throughput and ~8× lower latency on the wrk hello-world bench (numbers below).

```js
const express = require('@jimmyolo/u-expresso');

const app = express();

app.get('/', (req, res) => {
  res.json({ hello: 'world' });
});

app.listen(3000, () => {
  console.log('listening on :3000');
});
```

## Installation

This package is distributed via a separate GitHub repo ([`jimmyolo/uexpresso`](https://github.com/jimmyolo/uexpresso), `npm` branch), not via the npm registry:

```bash
npm install github:jimmyolo/uexpresso#npm
# or
pnpm add github:jimmyolo/uexpresso#npm
```

**Requires Node.js ≥ 22.**

The native uWebSockets.js binary depends on glibc; this package pins [`@jimmyolo/uws.js`](https://github.com/jimmyolo/uws.js) — an alma-Linux rebuild (glibc ≥ 2.34) — as the default runtime, with the upstream `uWebSockets.js` available as an optional dependency.

## Express 4 API

Implements the [Express 4 API](https://expressjs.com/en/4x/api.html). The test suite runs every test file **twice** — once against real Express and once against u-expresso — and asserts byte-identical stdout. The compatibility surface is honored down to obscure corners (jsonp, x-forwarded-host with IPv6 literals, trust-proxy variants, etc.).

(See `tests/` and `package.json` devDependencies for the full list.)

## HTTPS

```js
const app = express({
  uwsOptions: {
    key_file_name: 'key.pem',
    cert_file_name: 'cert.pem',
  },
});
```

## HTTP/3

```js
const app = express({
  h3: true,
  uwsOptions: {
    key_file_name: 'key.pem',
    cert_file_name: 'cert.pem',
  },
});
```

## Benchmark

### Cross-framework throughput

Test driver: [bun-http-framework-benchmark](https://github.com/jimmyolo/bun-http-framework-benchmark/pull/1/files) (bombardier).

| Framework | Runtime | Average | Ping | Query | Body |
| :-------: | :-----: | -----: | ---------: | ---------: | ---------: |
| uws | node | 59,946.06 | 62,933.11 | 60,971.38 | 55,933.69 |
| **u-expresso** | node | **37,133.26** | **46,197.68** | **44,697.20** | **20,504.91** |
| ultimate-express | node | 36,784.48 | 46,419.30 | 43,613.60 | 20,320.54 |
| h3 | node | 29,359.71 | 33,228.11 | 28,139.71 | 26,711.30 |
| fastify | node | 17,904.82 | 22,634.24 | 21,229.43 | 9,850.80 |
| express-5 | node | 13,278.71 | 14,848.28 | 12,738.12 | 12,249.73 |
| express-4 | node | 11,327.98 | 13,871.36 | 10,719.49 | 9,393.10 |

### vs Express v4 (wrk)

|              | u-expresso | express v4 |       |
| :----------: | ---------: | ---------: | ----: |
| Request/sec  | 318,722.27 |  82,487.36 | 3.86× |
| Avg. latency |  320.51 μs |    2.68 ms | 8.36× |
| p99 latency  |     639 μs |    3.56 ms | 5.57× |
| Transfer/sec |   49.55 MB |   14.79 MB | 3.35× |

Reproduce with `pnpm bench` (or `wrk -t 1 -c 200 -d 30 --latency http://127.0.0.1:3000` against `benchmark/server/u-expresso.js` and `benchmark/server/express-4.js`).

The wrk bench server (`benchmark/server/u-expresso.js`) enables `app.set('declarative responses', true)` — an opt-in optimization that compiles trivially-decidable handlers to uWS DeclarativeResponse. Without that flag, u-expresso runs through the standard JS handler path and the gap closes accordingly. (The cross-framework bombardier table above is from an external benchmark and uses its own server setup.)

Recorded against u-expresso `main` and express `4.21.2`, on Node.js `v24.15.0`, Linux 6.19 (Fedora 44), AMD Ryzen AI 9 HX 370.
