// must support res.sendFile() with large file

const fs = require("node:fs");
const express = require("express");
const app = express();

app.get('/test', (req, res) => {
    res.sendFile('tests/parts/large-file.json', { root: "." });
});

app.listen(13333, async () => {
    console.log('Server is running on port 13333');

    const response = await fetch('http://localhost:13333/test', {
        headers: {
            // no compression
            'Accept-Encoding': 'identity'
        }
    });
    // const text = await response.text();
    // let out = '';
    // for (let i = 0; i < text.length; i += 1000) {
    //     out += text.slice(i, i + 1);
    // }
    // console.log(out.length);
    const info = fs.statSync('./tests/parts/large-file.json');
    console.log(info.size === Number(response.headers.get('Content-Length')));
    console.log(response.headers.get('Content-Type').toLowerCase(), response.headers.get('Content-Length'));
    process.exit(0);
});