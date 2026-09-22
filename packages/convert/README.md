# convert/ — document conversion capability family

English | [中文](README.zh.md)

This family converts a file from one document format to another, and writes structured content out as one: a seam that plans a route across the registered converters, the converter providers themselves, and the two model-facing tools.

| Package | Role | ctx key |
|---|---|---|
| [`document-convert/`](document-convert/README.md) | Defines provider registration, route planning, fidelity, and shared errors | `ctx.documentConvert` |
| [`document-convert-libreoffice/`](document-convert-libreoffice/README.md) | Converts the document, spreadsheet, and presentation families through LibreOffice headless | registers on `ctx.documentConvert` |
| [`document-convert-pandoc/`](document-convert-pandoc/README.md) | Converts to and from HTML and plain text through pandoc's document model, where re-encoding a file format loses the structure | registers on `ctx.documentConvert` |
| [`document-convert-poppler/`](document-convert-poppler/README.md) | Extracts PDF text through `pdftotext` and `pdftohtml`, making PDF usable as a source | registers on `ctx.documentConvert` |
| [`tool-document-convert/`](tool-document-convert/README.md) | Exposes conversion to the model as `convert_document` | registers on `ctx.tools` |
| [`tool-official-document/`](tool-official-document/README.md) | Lays content out to GB/T 9704—2012 as `write_official_document`, writing the OpenDocument file itself and reaching every other format through the seam | registers on `ctx.tools` |

The seam plans routes of more than one step because that is the only way most cross-family conversions exist at all: no converter turns a PDF into a spreadsheet, but `pdf → txt → xlsx` does. Every route declares whether it preserves the source or only its text, and a plan reports the worst verdict among its steps, so a conversion never claims more than it did.

A provider whose binary is absent reports itself unusable and the seam plans around it, so a composition mounting both providers degrades to whichever converters the host actually has.
