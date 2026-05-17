// must reuse body buffers across consecutive requests without corruption

const express = require("express");
const bodyParser = require("body-parser");

const app = express();

app.use(bodyParser.json());

app.post('/echo', (req, res) => {
    res.send(req.body);
});

app.listen(13333, async () => {
    console.log('Server is running on port 13333');

    for(let i = 0; i < 5; i++) {
        const payload = { i, marker: 'a'.repeat(2048 + i * 13) };
        const response = await fetch('http://localhost:13333/echo', {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' },
        });
        const text = await response.text();
        console.log(text === JSON.stringify(payload) ? 'ok' : 'mismatch');
    }

    process.exit(0);
});
