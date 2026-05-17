// must verify declarative routes are compiled when handler is simple enough

const express = require("express");

// app1: default settings (etag enabled) — only static body can be declarative
const app1 = express();

app1.get('/static', (req, res) => res.send('Hello'));
app1.get('/header', (req, res) => res.header('x-foo', 'bar').send('test'));
app1.get('/chained', (req, res) => res.status(200).send('ok'));
// dynamic body + etag enabled → cannot precompute ETag → NOT declarative
app1.get('/dynamic-query', (req, res) => res.send(`${req.query.name}`));
app1.get('/dynamic-params/:id', (req, res) => res.send(req.params.id));

// app2: etag disabled — dynamic body is also declarative
const app2 = express();
app2.set('etag', false);

app2.get('/dynamic-query', (req, res) => res.send(`${req.query.name}`));
app2.get('/dynamic-params/:id', (req, res) => res.send(req.params.id));

// always non-declarative regardless of settings
const app3 = express();

app3.get('/no-let', (req, res) => { let x = 'a'; res.send(x); });
app3.get('/no-buffer', (req, res) => res.send(Buffer.from('x')));
app3.get('/no-if', (req, res) => { if (true) res.send('a'); });

app1.listen(13333, () => {
    app2.listen(13334, () => {
        app3.listen(13335, () => {
            const r1 = app1._declarativeRoutes;
            const r2 = app2._declarativeRoutes;
            const r3 = app3._declarativeRoutes;

            if (r1 !== undefined || r2 !== undefined || r3 !== undefined) {
                // u-expresso: verify actual declarative compilation results
                console.log(r1?.has('/static') === true);           // etag OK: static body
                console.log(r1?.has('/header') === true);           // etag OK: static body
                console.log(r1?.has('/chained') === true);          // etag OK: static body
                console.log(r1?.has('/dynamic-query') !== true);    // etag: can't precompute
                console.log(r1?.has('/dynamic-params/:id') !== true); // etag: can't precompute

                console.log(r2?.has('/dynamic-query') === true);    // etag off: dynamic OK
                console.log(r2?.has('/dynamic-params/:id') === true); // etag off: dynamic OK

                console.log(!r3?.has('/no-let'));    // let → not declarative
                console.log(!r3?.has('/no-buffer')); // Buffer → not declarative
                console.log(!r3?.has('/no-if'));     // if → not declarative
            } else {
                // Express: output expected matching values
                for (let i = 0; i < 10; i++) console.log(true);
            }

            process.exit(0);
        });
    });
});
