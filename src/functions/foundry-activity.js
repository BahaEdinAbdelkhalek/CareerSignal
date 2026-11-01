"use strict";

const df = require("durable-functions");
const { readCvText } = require("../services/storage");
const { analyseCv, createDrafts } = require("../services/foundry");

df.app.activity("FoundryActivity", {
    handler: async input => {
        if (input.action === "analyse") {
            const cvText = await readCvText(input.cvBlobName);
            return analyseCv(cvText, input.preferences || {});
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