const express = require('express');
const cors = require('cors');
const { enforceTlsAndHttps, getTlsPolicy } = require('./middleware/tls.enforcement');

const app = express();

// Trust proxy headers (e.g. X-Forwarded-Proto) from the upstream reverse proxy/load balancer
app.set('trust proxy', 1);

app.use(cors());
app.use(enforceTlsAndHttps);
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// BBMS-SR-001 / TC-Sec-01: TLS Policy & Status introspection
app.get('/api/security/tls-policy', getTlsPolicy);
app.get('/api/health/tls', getTlsPolicy);

app.use('/api/auth', require('./modules/auth/auth.routes'));
app.use('/api/donors', require('./modules/donor/donor.routes'));
app.use('/api/donations', require('./modules/collection/collection.routes'));
app.use('/api/lab', require('./modules/lab/lab.routes'));
app.use('/api/inventory', require('./modules/inventory/inventory.routes'));
app.use('/api/blood-requests', require('./modules/request/request.routes'));

module.exports = app;