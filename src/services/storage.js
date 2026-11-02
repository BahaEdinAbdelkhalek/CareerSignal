"use strict";

const { DefaultAzureCredential } = require("@azure/identity");
const { BlobServiceClient } = require("@azure/storage-blob");

function getContainerClient() {
    const accountUrl = process.env.CV_STORAGE_ACCOUNT_URL;
    const containerName = process.env.CV_CONTAINER_NAME || "candidate-cvs";
    if (!accountUrl) throw new Error("Missing app setting: CV_STORAGE_ACCOUNT_URL");

    // AZURE_CLIENT_ID should be the client ID of the Function App's user-assigned identity.
    const credential = new DefaultAzureCredential();
    const service = new BlobServiceClient(accountUrl, credential);
    return service.getContainerClient(containerName);
}

async function saveCvText(cvText, instanceId) {
    const container = getContainerClient();
    await container.createIfNotExists();

    const blobName = `${instanceId}/candidate-cv.txt`;
    const blockBlob = container.getBlockBlobClient(blobName);
    await blockBlob.uploadData(Buffer.from(cvText, "utf8"), {
        blobHTTPHeaders: { blobContentType: "text/plain; charset=utf-8" },
        metadata: { purpose: "temporary-cv-text", instanceid: instanceId }
    });
    return blobName;
}

async function readCvText(blobName) {
    const container = getContainerClient();
    const blob = container.getBlobClient(blobName);
    const download = await blob.download();
    if (!download.readableStreamBody) throw new Error("CV blob returned no readable stream.");

    const chunks = [];
    for await (const chunk of download.readableStreamBody) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
}

async function deleteCvText(blobName) {
    if (!blobName) return false;
    const container = getContainerClient();
    const result = await container.getBlobClient(blobName).deleteIfExists();
    return Boolean(result.succeeded);
}

async function deleteCvTextForInstance(instanceId) {
    if (!/^[0-9a-f-]{36}$/i.test(String(instanceId || ""))) return false;
    return deleteCvText(`${instanceId}/candidate-cv.txt`);
}

async function cleanupExpiredCvBlobs(retentionHours = 48) {
    const container = getContainerClient();
    await container.createIfNotExists();
    const cutoff = Date.now() - (Math.max(24, retentionHours) * 60 * 60 * 1000);
    let deleted = 0;
    let examined = 0;

    for await (const blob of container.listBlobsFlat()) {
        if (!/^[0-9a-f-]{36}\/candidate-cv\.txt$/i.test(blob.name)) continue;
        examined++;
        const lastModified = blob.properties?.lastModified;
        if (!lastModified || new Date(lastModified).getTime() >= cutoff) continue;
        const result = await container.getBlobClient(blob.name).deleteIfExists();
        if (result.succeeded) deleted++;
    }

    return { examined, deleted };
}

module.exports = {
    saveCvText,
    readCvText,
    deleteCvText,
    deleteCvTextForInstance,
    cleanupExpiredCvBlobs
};
