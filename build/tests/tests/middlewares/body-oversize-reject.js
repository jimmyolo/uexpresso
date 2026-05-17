// must handle oversize body rejection without crashing

const express = require("express");

const app = express();

app.use(express.urlencoded({ limit: '1kb', extended: false }));

app.post('/form', (req, res) => {
    res.json({ ok: true });
});

app.listen(13333, async () => {
    console.log('Server is running on port 13333');

    // 256KB body, well above the 1KB limit. Matches the bench-confirmed
    // reproducer of the Path A v1 lifecycle bug: Content-Length triggers
    // the early-reject path in body-parser; the body bytes still arrive on
    // Request's onData after the error response has been sent. At this
    // size, the body cannot fit in a single TCP segment delivered before
    // body-parser runs, so post-rejection onData is reliably exercised.
    // Would crash with `_res.pause()`-style backpressure; current main
    // and PR #100 push into an orphan Readable and exit cleanly.
    const oversizeBody = 'data=' + 'x'.repeat(256 * 1024);

    try {
        const response = await fetch('http://localhost:13333/form', {
            method: 'POST',
            body: oversizeBody,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        console.log('rejected:', response.status >= 400);
    } catch (err) {
        console.log('rejected:', true);
    }

    process.exit(0);
});
