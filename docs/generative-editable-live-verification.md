# Generative Editable PPTX Live Verification

This file records non-secret live verification results for the generative editable PPTX export path. Do not include API keys, bearer tokens, request headers, or private provider payloads.

## 2026-07-01

Environment:
- Local `config.yaml` contains OCR, image edit, and image generation provider settings.
- `scripts/smoke_generative_editable_pptx.py --config-check-only` reads all required roles and prints redacted diagnostics.
- `soffice`, `pdftoppm`, and local `tesseract` are available.

Commands:

```bash
/Users/lzj/miniconda3/bin/python scripts/smoke_generative_editable_pptx.py --config-check-only
/Users/lzj/miniconda3/bin/python scripts/smoke_generative_editable_pptx.py --provider-check image_edit --output-dir /private/tmp/aippt-provider-image-edit-live-check
/Users/lzj/miniconda3/bin/python scripts/smoke_generative_editable_pptx.py --provider-check image_generation --output-dir /private/tmp/aippt-provider-image-generation-live-check
/Users/lzj/miniconda3/bin/python scripts/smoke_generative_editable_pptx.py --slides one --output-dir /private/tmp/aippt-generative-editable-smoke-one
/Users/lzj/miniconda3/bin/python scripts/smoke_generative_editable_pptx.py --slides multi --output-dir /private/tmp/aippt-generative-editable-smoke-multi
```

Results:
- Configuration check passed with redacted provider diagnostics.
- Minimal `image_edit` provider check passed and produced an output image.
- Minimal `image_generation` provider check passed after sending the fixture source slide as a visual reference.
- Strict one-slide smoke passed with `validation_status: "passed"` and wrote `/private/tmp/aippt-generative-editable-smoke-one/smoke-one-16-9.pptx`.
- Strict multi-slide smoke passed with `validation_status: "passed"` and wrote `/private/tmp/aippt-generative-editable-smoke-multi/smoke-multi-16-9.pptx`.
- The local verification used schema-valid local OCR diagnostics plus configured live image edit/generation roles; smoke output redacted provider URLs and API keys.
- During repeated live attempts, the image edit provider intermittently returned upstream `503/524`; retryable 5xx handling and local retry settings were required for a stable pass.
- The final multi-slide PPTX editability spot check found editable `TEXT_BOX` objects on all three pages, editable `AUTO_SHAPE` objects on pages 1 and 2, an editable native `LINE` on page 1, and bitmap `PICTURE` assets for complex visuals/backgrounds.
- Preview validation passed for the final one-slide and multi-slide smoke outputs.
- Repair/source-crop behavior was exercised by the complex visual page: provider-generated complex-visual assets that fail QA can be replaced with exact source crops, preserving output fidelity instead of silently accepting drifted assets.

Hardening added from the failed live runs:
- Generated slide SSE payloads now carry AIPPT text metadata into the WebUI, so high-fidelity export can use known slide text instead of relying only on OCR content.
- The local `tesseract` OCR provider can be selected explicitly with `provider: "local_tesseract"` for development smoke tests.
- HTTP `429` and `5xx` provider errors are marked retryable, and pipeline provider calls honor `generative_editable_pptx.retries.provider_max_attempts` and `backoff_seconds`.
- Provider diagnostics and smoke config output keep API keys and base URLs redacted.
- Smoke diagnostics support direct OCR, image generation, and image edit provider checks before running the full pipeline. The image generation check now sends the fixture source slide as a visual reference, and the image edit check exercises the clean-base, asset-sheet, and repair edit roles.
- Source-native shape detection now supplements base-clean diff planning, so simple rectangle/rounded-rectangle/line pages can rebuild as native PPT shapes even when the edited base background drifts.
- Source-base diff residual filtering now drops page-edge noise, blank background residuals, and fill-only fragments inside detected source-native shapes before asset-sheet generation.
- Native-only flat-background pages use a deterministic local reconstruction background instead of a hallucinated model-cleaned background.
- Metadata-matching OCR text can use AIPPT text content even when local OCR reports low confidence, while obvious low-confidence pseudo-text from shapes is ignored.
- Complex whole-visual bitmap assets fall back to exact source crops when provider-generated transparent assets fail QA.
- Negative-slope native lines are validated by their endpoint bounding box because `python-pptx` exposes connector direction lossy through `left/top/width/height`.
- Base-clean background generation no longer reuses the text-only edit mask from text cleanup, avoiding contradictory full-background prompts with masked-only edit semantics.
- Low-confidence OCR pseudo-text is retained as a non-blocking warning instead of being silently swallowed; real short low-confidence text remains a blocking validation issue.
- Full-slide source-background safety validation now detects resized near-source backgrounds before allowing editable text over them.
