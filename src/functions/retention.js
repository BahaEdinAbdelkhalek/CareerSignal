"use strict";

const { app } = require("@azure/functions");
const { cleanupExpiredCvBlobs } = require("../services/storage");

const DEFAULT_CV_ORPHAN_RETENTION_HOURS = 48;

function getPositiveInteger(value, fallback, minimum = 1, maximum = 3650) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

app.timer("CleanupExpiredCareerSignalCvBlobs", {
    schedule: process.env.CAREERSIGNAL_RETENTION_CRON || "0 0 3 * * *",
    runOnStartup: false,
    useMonitor: true,
    handler: async (_timer, context) => {
        const blobCleanup = await cleanupExpiredCvBlobs(
            getPositiveInteger(
                process.env.CAREERSIGNAL_CV_ORPHAN_RETENTION_HOURS,
                DEFAULT_CV_ORPHAN_RETENTION_HOURS,
                24,
                720
            )
        );

        context.log("CareerSignal CV cleanup completed", {
            cvBlobsExamined: blobCleanup.examined,
            cvBlobsDeleted: blobCleanup.deleted
        });
    }
});

module.exports = { getPositiveInteger };
