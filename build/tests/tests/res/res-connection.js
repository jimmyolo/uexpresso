// must support res.connection

const express = require("express");

const app = express();

app.get('/test', (req, res) => {
    console.log(res.writableFinished);
    console.log(res.writableEnded);
    console.log(res.writable);
    console.log(res.socket.writable);
    res.end('bye', () => {
        // console.log(res.writable); // express 🐛 true forever...
        console.log(res.socket); // should be null after end(). https://nodejs.org/api/http.html#responsesocket
    });
    console.log(res.writableFinished);
    console.log(res.writableEnded);
    // console.log(res.socket.writable);
    // on express is true, might be true right after end(), due to asynchronous. But, highly suspect the same buggy with res.writable
    // false due to uws end() synchronize
    console.log(res.socket !== null);
});

app.listen(13333, async () => {
    console.log('Server is running on port 13333');

    const response = await fetch('http://localhost:13333/test');
    console.log(await response.text());

    process.exit(0);
});