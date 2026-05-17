// must support res.json()

const express = require("express");

const app = express();

app.get('/test', (req, res) => {
    res.json({ test: 'test' });
});

app.get('/status-body', (req, res) => {
    // deprecated: res.json(status, obj)
    res.json(201, { message: 'res.json(status, obj)' });
});

app.get('/body-status', (req, res) => {
    // deprecated: res.json(obj, status)
    res.json({ message: 'res.json(obj, status)' }, 201);
});

app.listen(13333, async () => {
    console.log('Server is running on port 13333');

    const response = await fetch('http://localhost:13333/test');
    console.log(response.headers.get('content-type'));
    console.log(await response.json());

    const res2 = await fetch('http://localhost:13333/status-body');
    console.log('deprecated: res.json(status, obj):', res2.status, await res2.text());

    const res3 = await fetch('http://localhost:13333/body-status');
    console.log('deprecated: res.json(obj, status):', res3.status, await res3.text());

    process.exit(0);
});