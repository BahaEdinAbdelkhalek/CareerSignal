"use strict";

const { app } = require("@azure/functions");
const df = require("durable-functions");
const { randomUUID } = require("node:crypto");
const { saveCvText, deleteCvText } = require("../services/storage");

const MAX_PDF_SIZE = 10 * 1024 * 1024;
const MAX_TEXT_SIZE = 100000;
const MAX_PREFERENCES_SIZE = 10000;

class InputError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

async function extractPdfText(buffer) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
    let text = "";

    try {
        let pdf;
        try {
            pdf = await loadingTask.promise;
        } catch {
            throw new InputError(422, "The PDF could not be read. Upload a valid, unencrypted, text-based PDF.");
        }
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const content = await page.getTextContent();
            text += content.items
                .filter(item => typeof item.str === "string")
                .map(item => item.str)
                .join(" ") + "\n";
            if (text.length > MAX_TEXT_SIZE) {
                throw new InputError(413, "Extracted CV text exceeds the 100,000 character limit.");
            }
        }
        return text;
    } finally {
        await loadingTask.destroy();
    }
}

function parsePreferences(value) {
    if (value === undefined || value === null || value === "") return {};
    if (typeof value === "string") {
        if (Buffer.byteLength(value, "utf8") > MAX_PREFERENCES_SIZE) {
            throw new InputError(413, "Preferences exceed the 10 KB limit.");
        }
        try {
            value = JSON.parse(value);
        } catch {
            throw new InputError(400, "Preferences must contain valid JSON.");
        }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new InputError(400, "Preferences must be a JSON object.");
    }
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_PREFERENCES_SIZE) {
        throw new InputError(413, "Preferences exceed the 10 KB limit.");
    }
    return value;
}

app.http("StartCareerSignal", {
    route: "career-signal",
    methods: ["POST"],
    authLevel: "function",
    extraInputs: [df.input.durableClient()],
    handler: async (request, context) => {
        let cvBlobName = null;
        try {
            const contentType = request.headers.get("content-type") || "";
            const declaredLength = Number(request.headers.get("content-length"));
            const maxRequestBytes = contentType.includes("multipart/form-data")
                ? MAX_PDF_SIZE + MAX_PREFERENCES_SIZE + (256 * 1024)
                : (MAX_TEXT_SIZE * 4) + MAX_PREFERENCES_SIZE + (64 * 1024);
            if (Number.isFinite(declaredLength) && declaredLength > 0 && declaredLength > maxRequestBytes) {
                throw new InputError(413, "Request body exceeds the permitted upload size.");
            }

            let cvText = "";
            let preferences = {};

            if (contentType.includes("multipart/form-data")) {
                const form = await request.formData();
                const uploadedFile = form.get("cv");

                if (!uploadedFile || typeof uploadedFile.arrayBuffer !== "function") {
                    throw new InputError(400, 'Missing PDF. Use the form-data field "cv".');
                }
                if (!(uploadedFile.name || "").toLowerCase().endsWith(".pdf")) {
                    throw new InputError(415, "Only PDF files are supported.");
                }
                if (uploadedFile.size > MAX_PDF_SIZE) {
                    throw new InputError(413, "PDF exceeds the 10 MB limit.");
                }

                const buffer = Buffer.from(await uploadedFile.arrayBuffer());
                if (buffer.length > MAX_PDF_SIZE) {
                    throw new InputError(413, "PDF exceeds the 10 MB limit.");
                }
                if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
                    throw new InputError(415, "The uploaded file is not a valid PDF document.");
                }

                cvText = (await extractPdfText(buffer)).trim();
                if (!cvText) {
                    throw new InputError(422, "No text found in PDF. Scanned PDFs require OCR.");
                }
                preferences = parsePreferences(form.get("preferences"));
            } else if (contentType.includes("application/json")) {
                let body;
                try {
                    body = await request.json();
                } catch {
                    throw new InputError(400, "Request body must contain valid JSON.");
                }
                cvText = typeof body.cvText === "string" ? body.cvText.trim() : "";
                preferences = parsePreferences(body.preferences);
            } else {
                throw new InputError(415, "Use multipart/form-data for PDF uploads or application/json for text CVs.");
            }

            if (!cvText) throw new InputError(400, "CV text is empty.");
            if (cvText.length > MAX_TEXT_SIZE) throw new InputError(413, "CV text exceeds 100,000 characters.");

            const instanceId = randomUUID();
            cvBlobName = await saveCvText(cvText, instanceId);
            const client = df.getClient(context);

            await client.startNew("CareerSignalOrchestrator", {
                instanceId,
                input: { cvBlobName, preferences }
            });

            return client.createCheckStatusResponse(request, instanceId);
        } catch (error) {
            if (cvBlobName) {
                await deleteCvText(cvBlobName).catch(cleanupError => {
                    context.error("Temporary CV cleanup failed after startup error:", cleanupError.name || "Error");
                });
            }

            if (error instanceof InputError) {
                return { status: error.status, jsonBody: { error: error.message } };
            }

            context.error("CareerSignal startup failed:", error.name || "Error");
            return {
                status: 500,
                jsonBody: {
                    error: "CareerSignal could not start the workflow.",
                    referenceId: context.invocationId
                }
            };
        }
    }
});
