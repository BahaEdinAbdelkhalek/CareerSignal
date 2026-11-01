"use strict";

const { app } = require("@azure/functions");
const df = require("durable-functions");
const { randomUUID } = require("node:crypto");

const { saveCvText } = require("../services/storage");

async function extractPdfText(buffer) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

    const pdf = await pdfjs.getDocument({
        data: new Uint8Array(buffer)
    }).promise;

    let text = "";

    try {
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const content = await page.getTextContent();

            text += content.items
                .filter(item => typeof item.str === "string")
                .map(item => item.str)
                .join(" ") + "\n";
        }
    } finally {
        await pdf.destroy();
    }

    return text;
}

const MAX_PDF_SIZE = 10 * 1024 * 1024;
const MAX_TEXT_SIZE = 100000;

function parsePreferences(value) {
    if (!value) return {};

    if (typeof value === "object" && !Array.isArray(value)) {
        return value;
    }

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);

            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch {
            throw new Error("Preferences must contain valid JSON.");
        }
    }

    throw new Error("Preferences must be a JSON object.");
}

app.http("StartCareerSignal", {
    route: "career-signal",
    methods: ["POST"],
    authLevel: "function",
    extraInputs: [df.input.durableClient()],

    handler: async (request, context) => {
        try {
            const contentType =
                request.headers.get("content-type") || "";

            let cvText = "";
            let preferences = {};

            // PDF upload
            if (contentType.includes("multipart/form-data")) {
                const form = await request.formData();

                const uploadedFile = form.get("cv");

                if (
                    !uploadedFile ||
                    typeof uploadedFile.arrayBuffer !== "function"
                ) {
                    return {
                        status: 400,
                        jsonBody: {
                            error: 'Missing PDF. Use the form-data field "cv".'
                        }
                    };
                }

                const filename = uploadedFile.name || "";

                if (!filename.toLowerCase().endsWith(".pdf")) {
                    return {
                        status: 400,
                        jsonBody: {
                            error: "Only PDF files are supported."
                        }
                    };
                }

                if (uploadedFile.size > MAX_PDF_SIZE) {
                    return {
                        status: 413,
                        jsonBody: {
                            error: "PDF exceeds the 10 MB limit."
                        }
                    };
                }

                const buffer = Buffer.from(
                    await uploadedFile.arrayBuffer()
                );
            context.log("PDF diagnostics:", {
                filename,
                declaredSize: uploadedFile.size,
                bufferLength: buffer.length,
                header: buffer.subarray(0, 8).toString("ascii"),
                headerHex: buffer.subarray(0, 8).toString("hex")
            });
                cvText = (await extractPdfText(buffer)).trim();
                if (!cvText) {
                    return {
                        status: 422,
                        jsonBody: {
                            error: "No text found in PDF. Scanned PDFs require OCR."
                        }
                    };
                }

                preferences = parsePreferences(
                    form.get("preferences")
                );

            // Existing JSON support
            } else if (contentType.includes("application/json")) {
                const body = await request.json();

                cvText =
                    typeof body.cvText === "string"
                        ? body.cvText.trim()
                        : "";

                preferences = parsePreferences(body.preferences);

            } else {
                return {
                    status: 415,
                    jsonBody: {
                        error: "Use multipart/form-data for PDF uploads or application/json for text CVs."
                    }
                };
            }

            if (!cvText) {
                return {
                    status: 400,
                    jsonBody: {
                        error: "CV text is empty."
                    }
                };
            }

            if (cvText.length > MAX_TEXT_SIZE) {
                return {
                    status: 413,
                    jsonBody: {
                        error: "CV text exceeds 100,000 characters."
                    }
                };
            }

            const instanceId = randomUUID();

            const cvBlobName = await saveCvText(
                cvText,
                instanceId
            );

            const client = df.getClient(context);

            await client.startNew(
                "CareerSignalOrchestrator",
                {
                    instanceId,
                    input: {
                        cvBlobName,
                        preferences
                    }
                }
            );

            return client.createCheckStatusResponse(
                request,
                instanceId
            );

        } catch (error) {
            context.error("CareerSignal startup failed:", error);

            return {
                status: 500,
                jsonBody: {
                    error: "Failed to start CareerSignal.",
                    details: error.message
                }
            };
        }
    }
});



