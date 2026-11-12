const express = require('express');
const cors = require('cors');
const { enforceTlsAndHttps, getTlsPolicy } = require('./middleware/tls.enforcement');
const { responseTime } = require('./middleware/response.time');

const app = express();

// Trust proxy headers (e.g. X-Forwarded-Proto) from the upstream reverse proxy/load balancer
app.set('trust proxy', 1);

// BBMS-NF-001: time every request (Server-Timing header) and log any slower than 2 s
app.use(responseTime());
app.use(cors());
app.use(enforceTlsAndHttps);
app.use(express.json());

// BBMS-SR-001 / TC-Sec-01: TLS Policy & Status introspection
app.get('/api/security/tls-policy', getTlsPolicy);
app.get('/api/health/tls', getTlsPolicy);

// BBMS-NF-002: /api/health, /api/health/live and /api/health/ready (public, for uptime monitors)
app.use('/api/health', require('./modules/health/health.routes'));

app.use('/api/auth', require('./modules/auth/auth.routes'));
app.use('/api/donors', require('./modules/donor/donor.routes'));
app.use('/api/donations', require('./modules/collection/collection.routes'));
app.use('/api/lab', require('./modules/lab/lab.routes'));
app.use('/api/inventory', require('./modules/inventory/inventory.routes'));
app.use('/api/blood-requests', require('./modules/request/request.routes'));

module.exports = app;