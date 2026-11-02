"use strict";

const df = require("durable-functions");
const { readCvText, deleteCvText } = require("../services/storage");
const { analyseCv, createDrafts } = require("../services/foundry");

df.app.activity("FoundryActivity", {
    handler: async input => {
        if (input.action === "analyse") {
            try {
                const cvText = await readCvText(input.cvBlobName);
                return await analyseCv(cvText, input.preferences || {});
            } finally {
                // CV text is a temporary claim-check payload, not a retained profile.
                await deleteCvText(input.cvBlobName).catch(() => undefined);
            }
        }

        if (input.action === "drafts") {
            return createDrafts({
                analysis: input.analysis,
                preferences: input.preferences || {},
                companies: input.companies || [],
                contacts: input.contacts || []
            });
        }

        throw new Error(`Unsupported FoundryActivity action: ${input.action}`);
    }
});
