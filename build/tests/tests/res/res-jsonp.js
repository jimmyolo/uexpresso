// must support res.jsonp()

const express = require("express");

const app = express();
app.set('jsonp callback name', 'callback2');

app.get('/test', (req, res) => {
    res.jsonp({ test: 'test' });
});

app.get('/status-body', (req, res) => {
    // deprecated: res.jsonp(status, obj)
    res.jsonp(201, { message: 'res.jsonp(status, obj)' });
});

app.get('/body-status', (req, res) => {
    // deprecated: res.jsonp(obj, status)
    res.jsonp({ message: 'res.jsonp(obj, status)' }, 201);
});

app.listen(13333, async () => {
    console.log('Server is running on port 13333');

    const response = await fetch('http://localhost:13333/test?callback2=test');
    console.log(await response.text(), response.headers.get('content-type'));

    const response2 = await fetch('http://localhost:13333/test');
    console.log(await response2.text(), response2.headers.get('content-type'));
    // without callback, X-Content-Type-Options should still be set
    console.log('nosniff without callback:', response2.headers.get('x-content-type-options'));

    const response3 = await fetch('http://localhost:13333/test?asdf=test');
    console.log(await response3.text(), response3.headers.get('content-type'));

    const res1 = await fetch('http://localhost:13333/status-body');
    console.log('deprecated: res.jsonp(status, obj):', res1.status, await res1.text());

    const res2 = await fetch('http://localhost:13333/body-status');
    console.log('deprecated: res.jsonp(obj, status):', res2.status, await res2.text());

    process.exit(0);
});