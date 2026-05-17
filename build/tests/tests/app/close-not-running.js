// must call close callback with ERR_SERVER_NOT_RUNNING when already closed

const express = require("express");

const app = express();

const server = app.listen(13333);

server.close();
server.close((err) => {
    console.log({ code: err && err.code });
    process.exit(0);
});
