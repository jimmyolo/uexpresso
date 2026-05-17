// fix: Try catch block doesn't work for "declarative responses"

const express = require("express");

const app = express();
app.set("declarative responses", true);

app.get("/", (req, res) => {
  try {
    const messages = { asd: 2 }
    res.json(messages);
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(13333, async() => {
    console.log(`Server listening on port ${13333}`);
    console.log((await fetch('http://localhost:13333/').then(r => r.text())));
    process.exit(0);
});