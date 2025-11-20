import axiosClient from "../config/axiosClient.js";
import client from "../config/openidClient.js";
import { isAccessTokenExpired } from "../utils/tokenUtils.js";

async function getUserPermissions(accessToken) {
    const url = `${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/token`;

    const params = new URLSearchParams();
    params.append("grant_type", "urn:ietf:params:oauth:grant-type:uma-ticket");
    params.append("audience", process.env.KEYCLOAK_CLIENT_ID);
    params.append("response_mode", "permissions");

    const response = await axiosClient.post(url, params, {
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/x-www-form-urlencoded"
        }
    });

    return response.data;
}

export function requireScope(resourceName, scopeName) {
    return async (req, res, next) => {
        try {
            let tokenSet = req.user?.tokenSet;
            if (!tokenSet) return res.status(401).json({ error: "Not authenticated" });

            // ✔ Step 1：自动刷新 access_token
            if (isAccessTokenExpired(tokenSet)) {
                const refreshedTokenSet = await client.refresh(tokenSet.refresh_token);

                // 替换 tokenSet
                tokenSet = refreshedTokenSet;

                // 更新 session
                req.user.tokenSet = tokenSet;
                req.session.passport.user.tokenSet = tokenSet;
            }

            // ✔ Step 2：获取用户权限
            const permissions = await getUserPermissions(tokenSet.access_token);

            const resource = permissions.find(p => p.rsname === resourceName);
            const allowed = resource && resource.scopes && resource.scopes.includes(scopeName);

            if (!allowed) {
                return res.status(403).json({ error: `Forbidden: missing scope ${scopeName}` });
            }

            next();
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Authorization error" });
        }
    }
}