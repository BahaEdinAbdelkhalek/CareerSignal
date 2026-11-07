const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 100000;

export async function extractPdfText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.length > MAX_PDF_BYTES) {
    throw new Error('PDF size is outside the permitted range.');
  }
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('The uploaded file is not a PDF.');
  }

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  let text = '';
  try {
    const pdf = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      text += content.items
        .filter(item => typeof item.str === 'string')
        .map(item => item.str)
        .join(' ') + '\n';
      if (text.length > MAX_TEXT_CHARS) throw new Error('Extracted CV text exceeds the permitted limit.');
    }
  } catch (error) {
    if (error.message.includes('permitted limit')) throw error;
    throw new Error('The PDF could not be read. Upload an unencrypted, text-based PDF.');
  } finally {
    await loadingTask.destroy();
  }

  const extracted = text.trim();
  if (!extracted) throw new Error('No text found in PDF. Scanned PDFs require OCR.');
  return extracted;
}
