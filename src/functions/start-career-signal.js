"use strict";

const { app } = require("@azure/functions");
const df = require("durable-functions");
const { randomUUID } = require("node:crypto");
const { saveCvText } = require("../services/storage");

app.http("StartCareerSignal", {
    route: "career-signal",
    methods: ["POST"],
    authLevel: "function",
    extraInputs: [df.input.durableClient()],
    handler: async (request, context) => {
        let body;
        try {
            body = await request.json();
        } catch {
            return { status: 400, jsonBody: { error: "Request body must be valid JSON." } };
        }

        const cvText = typeof body.cvText === "string" ? body.cvText.trim() : "";
        const preferences = body.preferences && typeof body.preferences === "object"
            ? body.preferences
            : {};

        if (!cvText) {
            return {
                status: 400,
                jsonBody: { error: "Provide the CV as plain text in the cvText field." }
            };
        }

        if (cvText.length > 100000) {
            return { status: 413, jsonBody: { error: "CV text is too large (maximum 100,000 characters)." } };
        }

        const instanceId = randomUUID();
        const cvBlobName = await saveCvText(cvText, instanceId);
        const client = df.getClient(context);

        await client.startNew("CareerSignalOrchestrator", {
            instanceId,
            input: { cvBlobName, preferences }
        });

        // Return the real Durable Functions status/query/terminate URLs.
        return client.createCheckStatusResponse(request, instanceId);
    }
});