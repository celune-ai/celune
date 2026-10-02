import express from 'express';

const app = express();
app.post('/jobs', (_req, res) => res.sendStatus(202));
app.listen(3000);
