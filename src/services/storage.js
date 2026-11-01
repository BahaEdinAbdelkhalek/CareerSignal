"use strict";

const { DefaultAzureCredential } = require("@azure/identity");
const { BlobServiceClient } = require("@azure/storage-blob");

function getContainerClient() {
    const accountUrl = process.env.CV_STORAGE_ACCOUNT_URL;
    const containerName = process.env.CV_CONTAINER_NAME || "candidate-cvs";

    if (!accountUrl) throw new Error("Missing app setting: CV_STORAGE_ACCOUNT_URL");

    // AZURE_CLIENT_ID should contain the CLIENT ID of hr-function-uami.
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
        blobHTTPHeaders: { blobContentType: "text/plain; charset=utf-8" }
    });

    return blobName;
}

async function readCvText(blobName) {
    const container = getContainerClient();
    const blob = container.getBlobClient(blobName);
    const download = await blob.download();
    const chunks = [];

    for await (const chunk of download.readableStreamBody) {
        chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString("utf8");
}

module.exports = { saveCvText, readCvText };