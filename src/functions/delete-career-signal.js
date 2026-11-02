"use strict";

const { app } = require("@azure/functions");
const df = require("durable-functions");
const { deleteCvTextForInstance } = require("../services/storage");

const TERMINAL_STATUSES = new Set(["Completed", "Failed", "Terminated", "Canceled"]);

app.http("DeleteCareerSignal", {
    route: "career-signal/{instanceId}",
    methods: ["DELETE"],
    authLevel: "function",
    extraInputs: [df.input.durableClient()],
    handler: async (request, context) => {
        const instanceId = request.params?.instanceId || "";
        if (!/^[0-9a-f-]{36}$/i.test(instanceId)) {
            return { status: 400, jsonBody: { error: "A valid CareerSignal instance ID is required." } };
        }

        const client = df.getClient(context);
        const status = await client.getStatus(instanceId, {
            showHistory: false,
            showHistoryOutput: false,
            showInput: false
        });

        if (!status) {
            // Also clean up a possible orphaned CV blob for this UUID.
            try {
                await deleteCvTextForInstance(instanceId);
            } catch (error) {
                context.error("Orphaned CV cleanup failed:", error.name || "Error");
                return { status: 500, jsonBody: { error: "CareerSignal data could not be deleted. Retry the request." } };
            }
            return { status: 404, jsonBody: { error: "CareerSignal instance was not found." } };
        }

        if (!TERMINAL_STATUSES.has(status.runtimeStatus)) {
            return {
                status: 409,
                jsonBody: { error: "This workflow is still running. Terminate it before deleting its data." }
            };
        }

        try {
            await deleteCvTextForInstance(instanceId);
            await client.purgeInstanceHistory(instanceId);
        } catch (error) {
            context.error("CareerSignal deletion failed:", error.name || "Error");
            return { status: 500, jsonBody: { error: "CareerSignal data could not be fully deleted. Retry the request." } };
        }

        return { status: 200, jsonBody: { deleted: true, instanceId } };
    }
});
