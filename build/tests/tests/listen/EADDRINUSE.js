// must emit EADDRINUSE error on server

const express = require("express");

const app1 = express();
const app2 = express();

app1.listen(13333, (token1) => {
  console.log({ token1 });
  const server2 = app2.listen(13333, '127.0.0.1', (token2) => {
    console.log({ token2 });
    process.exit(0);
  });
  server2.on('error', (err) => {
    console.log({ errorCode: err.code });
    process.exit(0);
  });
});
