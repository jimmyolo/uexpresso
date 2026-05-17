// must call close callback with no error after listening

const express = require("express");

const app = express();

const server = app.listen(13333, () => {
    server.close((err) => {
        if(err) {
            throw err;
        }
        console.log("Server closed successfully");
        process.exit(0);
    });
});
