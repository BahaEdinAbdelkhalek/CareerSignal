"use strict";

let DefaultAzureCredential;
let SecretClient;
let client = null;
let clientUrl = null;
const secretCache = new Map();

function getSecretClient() {
    const vaultUrl = process.env.KEY_VAULT_URL;
    if (!vaultUrl) throw new Error("Missing app setting: KEY_VAULT_URL");

    if (!client || clientUrl !== vaultUrl) {
        // Lazy-load Azure SDKs so unit tests and local syntax checks do not need
        // Azure credentials just to import the application modules.
        ({ DefaultAzureCredential } = require("@azure/identity"));
        ({ SecretClient } = require("@azure/keyvault-secrets"));
        const credential = new DefaultAzureCredential();
        client = new SecretClient(vaultUrl, credential);
        clientUrl = vaultUrl;
        secretCache.clear();
    }
    return client;
}

async function getSecret(secretName) {
    const secretClient = getSecretClient();
    if (!secretCache.has(secretName)) {
        const promise = secretClient.getSecret(secretName)
            .then(secret => {
                if (!secret.value) throw new Error("Secret has no value: " + secretName);
                return secret.value;
            })
            .catch(error => {
                secretCache.delete(secretName);
                throw new Error(`Key Vault retrieval failed for ${secretName}: ${error.message}`);
            });
        secretCache.set(secretName, promise);
    }
    return secretCache.get(secretName);
}

module.exports = { getSecret };
