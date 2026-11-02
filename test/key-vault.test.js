"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getSecret } = require("../src/services/key-vault");

test("Key Vault configuration is validated lazily, not during function registration", async () => {
    const previous = process.env.KEY_VAULT_URL;
    delete process.env.KEY_VAULT_URL;
    await assert.rejects(getSecret("GetProspectApiKey"), /Missing app setting: KEY_VAULT_URL/);
    if (previous !== undefined) process.env.KEY_VAULT_URL = previous;
});
