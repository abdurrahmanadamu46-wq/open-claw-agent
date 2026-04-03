---
name: rag-anything
description: Use when the user wants to query documents (PDF, Office, images) with RAG, or to build/run a multimodal RAG pipeline. Wraps RAG-Anything (LightRAG-based, all-in-one multimodal RAG).
---

# RAG-Anything for OpenClaw

Use this skill when the user wants to **query documents** (PDF, DOCX, images, tables, equations) with retrieval-augmented generation, or to **process and index** multimodal documents for later querying.

## When to Use

- User asks to "query this PDF", "ask questions about this document", "RAG over these files".
- User wants to set up a document knowledge base and then ask questions in natural language.
- User needs multimodal RAG (text + images + tables + equations) in one pipeline.

## Backend

[RAG-Anything](https://github.com/HKUDS/RAG-Anything) is installed in the environment. The agent can:

1. **Run Python scripts** that use `raganything` (e.g. `from raganything import RAGAnything, RAGAnythingConfig`).
2. **Invoke CLI or example scripts** if available (e.g. `python examples/raganything_example.py ...`).
3. **Use bash** to run one-off document processing or query commands.

## Typical Workflow

1. **Process document**: Run a small Python snippet or script that calls `RAGAnything.process_document_complete(file_path=..., output_dir=...)` with the user's file path and chosen parser (mineru / docling / paddleocr).
2. **Query**: Call `rag.aquery("user question", mode="hybrid")` or equivalent and return the answer to the user.
3. **Config**: Use `RAGAnythingConfig(working_dir=..., parser="mineru", enable_image_processing=True, ...)` as in the official examples. LLM/embedding keys should come from environment variables (e.g. `OPENAI_API_KEY`).

## Constraints

- API keys (OpenAI or base_url) must be set in the environment or passed securely; do not hardcode.
- Office document parsing may require LibreOffice installed in the container.
- For large docs or first run, processing can be slow; inform the user if needed.

## Output

Return the RAG answer in clear text. If processing fails, report the error and suggest checking file path, format, and env vars.
