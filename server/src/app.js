const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', require('./modules/auth/auth.routes'));
app.use('/api/donors', require('./modules/donor/donor.routes'));
app.use('/api/donations', require('./modules/collection/collection.routes'));
app.use('/api/lab', require('./modules/lab/lab.routes'));
app.use('/api/inventory', require('./modules/inventory/inventory.routes'));
app.use('/api/blood-requests', require('./modules/request/request.routes'));

module.exports = app;