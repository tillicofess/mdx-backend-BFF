import express from 'express';
import { Issuer, Strategy } from 'openid-client';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from "cookie-parser";
import passport from 'passport';
import expressSession from 'express-session';
import articleRoutes from './routes/articleRoutes.js';
import largeFileRoutes from './routes/largeFile.js';
import pool from './config/db.js';

dotenv.config();

const app = express();
const PORT = 3001;
const FRONTEND_URLS = ['http://127.0.0.1:4000', 'http://127.0.0.1:4001'];

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
const memoryStore = new expressSession.MemoryStore();
app.use(expressSession({
    store: memoryStore,
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true
}));
app.use(passport.initialize());
app.use(passport.authenticate('session'));

app.use(cors({
    origin: FRONTEND_URLS,
    credentials: true
}));


// use the issuer url here
const keycloakIssuer = await Issuer.discover(process.env.KEYCLOAK_ISSUER);

const client = new keycloakIssuer.Client({
    client_id: process.env.KEYCLOAK_CLIENT_ID,
    client_secret: process.env.KEYCLOAK_CLIENT_SECRET,
    redirect_uris: [process.env.KEYCLOAK_REDIRECT_URI],
    post_logout_redirect_uris: [process.env.KEYCLOAK_POST_LOGOUT_REDIRECT_URI],
    response_types: ['code'],
});

passport.use('oidc', new Strategy({ client }, (tokenSet, userinfo, done) => {
    const sessionData = {
        tokenSet,
        claims: tokenSet.claims(),
    };
    return done(null, sessionData);
})
)

passport.serializeUser(function (user, done) {
    done(null, user);
});
passport.deserializeUser(function (user, done) {
    done(null, user);
});

// 中间件：检查用户是否已认证
const checkAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ error: 'Not authenticated' });
};

app.use('/articles', checkAuthenticated, articleRoutes);
app.use('/largeFile', checkAuthenticated, largeFileRoutes);

app.get('/login', (req, res, next) => {
    if (req.query.redirectBack) {
        // 将前端希望重定向的 URL 存储在 session 中
        req.session.returnTo = req.query.redirectBack;
        console.log(`[LOGIN] Saving return URL: ${req.session.returnTo}`);
    }
    // 发起 OIDC 认证流程，这将重定向到 Keycloak
    passport.authenticate('oidc')(req, res, next);
});

app.get('/auth/callback', (req, res, next) => {
    const redirectUrl = req.session.returnTo || '/';
    console.log(`[CALLBACK] Login successful. Redirecting to: ${redirectUrl}`);
    passport.authenticate('oidc', (err, user, info) => {
        if (err || !user) {
            console.error('[CALLBACK] Login failed:', err || info);
            return res.redirect('/');
        }
        req.login(user, (err) => {
            if (err) return next(err);
            delete req.session.returnTo;
            res.redirect(redirectUrl);
        });
    })(req, res, next);
});

app.get('/me', (req, res) => {
    if (!req.isAuthenticated()) return res.json({ authenticated: false, userInfo: null });
    res.json({
        authenticated: true,
        userInfo: {
            username: req.user.claims.preferred_username,
            roles: req.user.claims.realm_access ? req.user.claims.realm_access.roles : [],
        }
    });
});

// 🧩 调试接口
app.get('/debug/sessions', (req, res) => {
    memoryStore.all((err, sessions) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ sessions });
    });
});

app.get('/logout', (req, res) => {
    const idToken = req.user?.tokenSet?.id_token;
    const logoutUrl = client.endSessionUrl({
        id_token_hint: idToken,
        post_logout_redirect_uri: process.env.KEYCLOAK_POST_LOGOUT_REDIRECT_URI,
    });
    res.redirect(logoutUrl);
});

app.get('/frontchannel-logout', (req, res) => {
    console.log('[FRONTCHANNEL LOGOUT] Request received');

    if (req.isAuthenticated()) {
        const username = req.user.claims.preferred_username;
        console.log(`[FRONTCHANNEL LOGOUT] Clearing session for ${username}`);

        req.logout(err => {
            if (err) return next(err);
            req.session.destroy(() => {
                res.send('User logged out via front-channel');
            });
        });
    } else {
        console.log('[FRONTCHANNEL LOGOUT] No active session found');
        res.send('No session found');
    }
});


// 测试数据库连接函数
async function testDatabaseConnection() {
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.query('SELECT 1');
        console.log('✅ 数据库连接测试成功:', rows);
    } catch (error) {
        console.error('❌ 数据库连接测试失败:', error.message);
        process.exit(1); // 停止应用启动
    } finally {
        if (connection) connection.release();
    }
}

testDatabaseConnection()
    .then(() => {
        app.listen(PORT, function () {
            console.log(`Listening at http://localhost:${PORT}`);
        });
    })
    .catch(err => {
        console.error('❌ 应用启动失败:', err.message);
        process.exit(1); // 停止应用启动
    });