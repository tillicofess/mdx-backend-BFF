import express from 'express';
import { Strategy } from 'openid-client';
import client from './config/openidClient.js';
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
const FRONTEND_URL = 'http://127.0.0.1:4001';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
}));

const memoryStore = new expressSession.MemoryStore();
app.use(expressSession({
    store: memoryStore,
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true
}));

app.use(passport.initialize());
app.use(passport.authenticate('session'));

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

app.get('/login', (req, res, next) => {
    // 发起 OIDC 认证流程，这将重定向到 Keycloak
    passport.authenticate('oidc')(req, res, next);
});

app.get('/auth/callback', (req, res, next) => {
    const redirectUrl = FRONTEND_URL;
    passport.authenticate('oidc', (err, user, info) => {
        if (err || !user) {
            console.error('[CALLBACK] Login failed:', err || info);
            return res.redirect(redirectUrl); // 登录失败，重定向到前端安全页面 #待处理
        }
        req.login(user, (err) => {
            if (err) return next(err);
            res.redirect(redirectUrl);
        });
    })(req, res, next);
});

app.get('/me', (req, res) => {
    if (!req.isAuthenticated()) return res.json({ authenticated: false, userInfo: null });
    const roles = (req.user.claims.roles || []).filter(role => role.startsWith("role_"));
    res.json({
        authenticated: true,
        userInfo: {
            username: req.user.claims.preferred_username,
            uuid: req.user.claims.sub,
            roles: roles
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
    req.logout(err => {
        if (err) return next(err);
        req.session.destroy(() => {
            const logoutUrl = client.endSessionUrl({
                id_token_hint: idToken,
                post_logout_redirect_uri: process.env.KEYCLOAK_POST_LOGOUT_REDIRECT_URI,
            });
            res.redirect(logoutUrl);
        })
    })
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

app.use('/articles', checkAuthenticated, articleRoutes);
app.use('/largeFile', checkAuthenticated, largeFileRoutes);

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