const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { getDatabase } = require('./db');
const env = require('./config/env');
const { getSessionStore } = require('./services/session-store');
const adminRoutes = require('./modules/admin/routes');
const publicCheckRoutes = require('./modules/public-check/routes');

const app = express();

if (env.nodeEnv === 'production') {
  app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    store: getSessionStore(),
    secret: env.sessionSecret,
    proxy: env.nodeEnv === 'production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.nodeEnv === 'production',
    },
  })
);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  const db = getDatabase();

  res.json({
    ok: true,
    env: env.nodeEnv,
    db: {
      path: env.dbPath,
      connected: Boolean(db),
    },
  });
});

app.get('/', (req, res) => {
  res.render('public/home', {
    title: 'Balance Checker Pro',
  });
});

app.use('/', publicCheckRoutes);
app.use('/admin', adminRoutes);

app.use((error, req, res, next) => {
  if (error && error.code === 'EBADCSRFTOKEN') {
    return res.status(403).send('Invalid or expired admin form token');
  }

  return next(error);
});

module.exports = app;
