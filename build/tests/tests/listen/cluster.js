// must support cluster

const express = require("express");

const cluster = require('cluster');

process.on('uncaughtException', (err) => {
  console.log({errorCode: err.code});
  process.exit(0);
});

const WORKERS = 2;

if (cluster.isPrimary) {
  console.log(`Master is running`);

  // Fork workers
  for (let i = 0; i < WORKERS; i++) {
    cluster.fork();
  }

  cluster.on('exit', () => {
    console.log(`Worker died`);
  });

} else {
  const app = express();

  app.listen(3000, () => {
    console.log(`Worker started`);

    setTimeout(() => {
      process.exit(0);
    }, 2000);
  });
}