# Generative Editable PPTX Export

Generative editable PPTX export rebuilds a generated slide image into a PowerPoint deck with editable text boxes, conservative native shapes, and positioned bitmap assets. It is separate from the existing raster PPTX export and from the image-layer editable PPTX OpenSpec backup plan.

## When To Use It

Use **High-fidelity editable PPTX** when a deck needs to be edited in PowerPoint after generation and quality is more important than model cost. The existing **PPTX** option remains a raster export: each generated slide image is placed as a full-slide picture.

The generative editable path is quality-gated. The default fallback policy is `fail`, so AIPPT returns an error instead of silently giving the user a lower-fidelity PPTX when validation fails.

## Request Contract

`POST /api/export`

```json
{
  "format": "generative_editable_pptx",
  "aspect_ratio": "16:9",
  "slide_order": ["slide-1", "slide-2"],
  "editable_options": {
    "fallback_policy": "fail"
  },
  "slides": [
    {
      "slide_id": "slide-1",
      "image_base64": "...",
      "text_metadata": [
        {
          "text": "Quarterly Plan",
          "role": "title",
          "order": 1,
          "style_hint": {
            "font_size": 32,
            "bold": true
          }
        }
      ]
    }
  ]
}
```

Supported `fallback_policy` values:

- `fail`: default. Return an error if validation fails.
- `text_editable_background`: explicitly allow a lower-fidelity PPTX that keeps editable text boxes over the generated text-clean background when full foreground reconstruction fails after artifacts are available.
- `raster_pptx`: explicitly allow falling back to the existing raster PPTX exporter.

Fallback output is never returned unless the request explicitly permits it. When fallback is used, the response includes `X-Generative-Editable-Fallback-Policy` and `X-Generative-Editable-Fallback-Used` headers.

## Configuration

Provider settings live in `config.yaml`. `config.example.yaml` documents the expected shape with placeholder values.

```yaml
api:
  models:
    prompt_model:
      adapter: "openai_chat"
      model: "..."
      base_url: "..."
      api_key: "..."
    image_model:
      adapter: "raw_chat_multimodal"
      model: "..."
      base_url: "..."
      api_key: "..."
    edit_model:
      adapter: "raw_chat_multimodal"
      model: "..."
      base_url: "..."
      api_key: "..."
    ocr_model:
      provider: "..."
      model: "..."
      base_url: "..."
      api_key: "..."
      # For local development smoke tests:
      # provider: "local_tesseract"
      # model: "eng"
      # base_url: ""
      # api_key: ""

generative_editable_pptx:
  reconstruction:
    mode: "generative"
    clean_base_model: "edit_model"
    asset_sheet_model: "edit_model"
    repair_model: "edit_model"
    generation_model: "image_model"
  ocr:
    model: "ocr_model"
    use_aippt_metadata_first: true
    min_confidence: 0.75
  quality:
    max_repair_attempts: 2
    preview_similarity_threshold: 0.92
    require_preview_validation: true
```

Do not commit real provider credentials. Before live verification, populate local `config.yaml` with OCR, image edit, and image generation provider settings, then run a one-slide smoke test before multi-slide verification.

The current live adapter is an OpenAI-compatible chat-completions multimodal adapter (`openai_chat` or `raw_chat_multimodal`). It sends slide images as `image_url` message parts and expects the provider response to contain an image URL, data URL, or base64 image payload. It is not the official OpenAI Images API edit endpoint. If a provider requires multipart image-edit requests, add a provider-specific adapter behind the existing provider interfaces instead of changing the export contract; unsupported adapter names fail during dependency construction instead of silently using the wrong protocol.

## Pipeline

1. Create a job artifact directory and write source images.
2. Run OCR. When `use_aippt_metadata_first` is enabled, AIPPT text metadata is used as semantic text when available; OCR supplies layout, style, color, and fallback text. When disabled, OCR text is used directly.
3. Build text masks from accepted OCR/text boxes.
4. Create `text_clean_background` and `base_clean_background` assets.
5. Plan foreground candidates from source/base-clean differences.
6. Convert high-confidence simple geometry to native PowerPoint shapes.
7. Generate bitmap assets for complex foreground regions through the configured asset-sheet provider and run configured bounded repair for failed assets. Source crops are only available when the pipeline dependency explicitly enables that internal diagnostic fallback; request fallback policies do not silently enable source crops.
8. Compose PPTX using cleaned background, native shapes, bitmap assets, and editable text boxes.
9. Validate structure and preview similarity. Repair bounded issues when possible.
10. Return the validated deck, or an explicit fallback/error.

## Quality And Cost Notes

This path uses OCR plus image editing/image generation providers. It can require multiple provider calls per page: cleanup, asset sheet generation, repairs, and validation retries. That is expected; the design optimizes output quality first and leaves cost optimization to caching, component reuse, bounded concurrency, and explicit fallback policies.

## Limitations

- Bitmap assets are source-guided through provider calls and local slicing, but generated or repaired assets may not be pixel-identical to the original slide image.
- Native shape conversion is conservative; uncertain regions stay as bitmap assets instead of inaccurate PowerPoint shapes.
- Text editability depends on OCR quality and available AIPPT text metadata.
- Current strict live smoke is not passing with the local provider set recorded on 2026-07-01 because OCR and image-edit upstream calls fail provider validation; see `docs/generative-editable-live-verification.md`.
- Real provider smoke tests require local `config.yaml` settings and are not part of default CI.

## Relation To Image-Layer Export

The image-layer editable PPTX plan is a separate backup path for future model resources. Image-layer decomposition can produce movable/scalable/croppable visual layers, but it does not automatically produce native PowerPoint text boxes, editable line styles, or editable rounded rectangles. The generative editable export path composes a PPTX from OCR, native-shape fitting, provider-generated assets, and validation.
