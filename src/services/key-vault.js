"use strict";

const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

const vaultUrl = process.env.KEY_VAULT_URL;

if (!vaultUrl) {
    throw new Error("Missing application setting: KEY_VAULT_URL");
}

const credential = new DefaultAzureCredential();
const client = new SecretClient(vaultUrl, credential);

const secretCache = new Map();

async function getSecret(secretName) {
    if (!secretCache.has(secretName)) {
        const promise = client.getSecret(secretName)
            .then(secret => {
                if (!secret.value) {
                    throw new Error("Secret has no value: " + secretName);
                }

                return secret.value;
            })
            .catch(error => {
                secretCache.delete(secretName);

                throw new Error(
                    "Key Vault retrieval failed for " +
                    secretName +
                    ": " +
                    error.message
                );
            });

        secretCache.set(secretName, promise);
    }

    return secretCache.get(secretName);
}

module.exports = { getSecret };