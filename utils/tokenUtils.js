export function isAccessTokenExpired(tokenSet) {
    const expiresAt = tokenSet?.expires_at;

    if (typeof expiresAt === 'number') {
        const now = Math.floor(Date.now() / 1000);
        return now >= (expiresAt - 10); // 留 10s 安全窗
    }

    return true;
}
