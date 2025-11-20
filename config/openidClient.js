import { Issuer } from "openid-client";
import dotenv from "dotenv";
dotenv.config();

const keycloakIssuer = await Issuer.discover(process.env.KEYCLOAK_ISSUER);

const client = new keycloakIssuer.Client({
    client_id: process.env.KEYCLOAK_CLIENT_ID,
    client_secret: process.env.KEYCLOAK_CLIENT_SECRET,
    redirect_uris: [process.env.KEYCLOAK_REDIRECT_URI],
    post_logout_redirect_uris: [process.env.KEYCLOAK_POST_LOGOUT_REDIRECT_URI],
    response_types: ["code"],
});

export default client;
