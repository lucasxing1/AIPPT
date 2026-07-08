# AI PPT Generator

[English](README.md) | [中文](README_zh.md)

Recreate NotebookLM's AI PPT feature and extend it into a controllable, editable, model-configurable PPT workbench that converts papers, documents, and other materials into beautiful PPT images.

![AIPPT workbench demo](docs/assets/aippt-demo.gif)

[Watch the HD demo video](docs/assets/aippt-demo.webm)

The demo covers uploading `doc/L9.md`, entering custom requirements, generating and editing the design outline, confirming page designs, generating a 6-slide deck, editing one slide, confirming the replacement, and exporting PDF/PPTX. Model waiting time is fast-forwarded.

## More Than A Clone

NotebookLM's PPT feature is closer to a one-click result generator, with limited visibility into the design process and limited per-slide control. This project turns the workflow into an understandable, editable workbench:

- **Visible process**: Review the deck outline and page-by-page design notes before image generation
- **Per-slide control**: Edit any slide independently, generate new versions, revert history, and confirm replacements
- **Model control**: Configure separate OpenAI-compatible models for text planning, image generation, and image editing
- **Local-first config**: Manage model connections through local `config.yaml` or WebUI local API configuration; saved projects and exported files do not include API keys
- **Export-ready output**: Export generated decks to PDF/PPTX for presentation or further editing
- **Experimental high-fidelity editable PPTX export**: Rebuild slide images into editable PowerPoint text boxes, conservative native shapes, and positioned bitmap assets through a provider-gated generative editable export path

## ✨ Features

- 🎨 **Per-slide image generation**: Create an editable outline and page designs before converting them into PPT page images
- 🌐 **PPT Workbench**: Upload sources, configure model roles, preview slides, edit pages, track history, and export
- 📝 **Multi-format parsing**: Supports `.md/.txt/.pdf/.docx/.pptx` input and converts content to Markdown
- ✏️ **Full-page image editing**: Edit each generated slide independently, revert history, and confirm replacements
- 🔀 **Three model roles**: Configure `prompt_model`, `image_model`, and `edit_model` separately
- 🖼️ **Image result compatibility**: Accepts URLs, Markdown image links, data URLs, `b64_json`, and raw base64
- 💾 **Local multi-project persistence**: Save multiple PPT projects in the browser, including source content, outline, page designs, generated images, and per-slide edit history
- 📤 **Editable PPTX reconstruction**: Export a separate experimental high-fidelity editable PPTX mode after provider verification; see [Generative Editable PPTX Export](docs/generative-editable-pptx.md)

## 🚀 Quick Start

### 1. Installation & Configuration

```bash
# Clone the project
git clone <repository-url>
cd OpenNotebookLM-AIPPT

# Configure API keys
cp config.example.yaml config.yaml
# Edit config.yaml and fill in your API keys
```

### 2. Start Services

**Option 1: WebUI Interface (Recommended)**

```bash
# One-click start for both frontend and backend
./start.sh
```

After startup, visit:
- 🎨 Frontend: http://localhost:5173
- 📚 API Docs: http://localhost:8000/docs

**Option 2: Start Frontend and Backend Separately**

```bash
# Terminal 1: Start backend
./start-api.sh

# Terminal 2: Start frontend
cd web && npm install && npm run dev
```

**Option 3: Command Line Usage**

```bash
# Install dependencies
pip install -r requirements.txt

# Basic usage
python main.py -i doc/L9.md -n 5

# Generate prompts only
python main.py -i doc/L9.md -n 5 --prompt-only -o prompts.json

# Generate from prompt file
python main.py --from-prompt prompts.json
```

### Local Project Persistence

AIPPT stores project content and image assets in the current browser profile's IndexedDB, and uses localStorage for the active project id, UI preferences, and local API configuration. Saved project data includes uploaded sources, content settings, design outlines, page designs, generated images, edited versions, and image data needed for export.

Notes:
- Clearing browser site data removes local projects.
- Projects do not automatically sync across browsers or devices.
- API keys belong to local API configuration; they are not written into saved project records and are not included in exported PDF/PPTX files.

### 3. WebUI Usage Flow

1. **Upload Document**: Drag and drop or click to upload a source file in the left panel
2. **Configure Models**: Configure text, image generation, and image editing model roles
3. **Set Parameters & Requirements**: Choose page count, resolution, aspect ratio, language, style, audience, and custom requirements
4. **Confirm Design**: Generate an editable outline, confirm it, then review the generated page designs
5. **Generate PPT**: Generate slide images after page-design confirmation and watch real-time progress
6. **Preview & Edit**: Preview generated slides in the right panel and edit a single page when needed
7. **Export**: Export to PDF or PPTX

The export menu keeps the existing raster PPTX option and adds a separate experimental high-fidelity editable PPTX option. The editable mode uses OCR plus image editing/image generation providers and is quality-gated by default; it fails rather than silently returning a low-fidelity deck unless an explicit fallback policy is requested. Strict live provider verification is still pending for the currently tested provider set. See [Generative Editable PPTX Export](docs/generative-editable-pptx.md).

The built-in demo source is `doc/L9.md`. This is a repository-relative path, so a fresh clone can use it directly in the WebUI or CLI examples.

## 📁 Project Structure

```
OpenNotebookLM-AIPPT/
├── src/                    # Core logic
├── api/                    # FastAPI backend
├── web/                    # React frontend
├── tests/                  # Tests
├── doc/                    # Input documents directory
│   └── L9.md               # Default demo source
├── config.yaml             # Configuration file
├── start.sh                # One-click startup script
└── main.py                 # CLI entry point
```

## ⚙️ Configuration

All configurations are managed in `config.yaml`, including:
- API configuration (`prompt_model`, `image_model`, `edit_model`)
- Generative editable PPTX provider roles and quality gates (`ocr_model`, cleanup, asset generation, repair, validation)
- PPT default settings (language, style, page count)
- Timeout and retry settings

See `config.example.yaml` for detailed configuration examples.

### Using OpenAI Compatible API

The current protocol is OpenAI-compatible `/chat/completions`: text profiles use
chat completions, and image/edit profiles use multimodal chat completions that
return an image URL, data URL, or base64 payload.

```yaml
api:
  models:
    prompt_model:
      model: "gpt-4o"
      base_url: "https://api.openai.com/v1"
      api_key: "sk-xxx"
    image_model:
      model: "gpt-image-2"
      base_url: "https://api.example.com/v1"
      api_key: "sk-xxx"
    edit_model:
      model: "gpt-image-2"
      base_url: "https://api.example.com/v1"
      api_key: "sk-xxx"
```

## 📤 Output Structure

```
output/ppt_20241201_123456/
├── source_material.txt      # Original input material
├── prompts.json             # Generated prompts
├── result.json              # Generation result
├── presentation.pdf         # Exported PDF
└── images/                  # Slide images
```

## 🧪 Development Checks

Recommended local runtime:
- Python 3.11 or 3.12
- Node.js 20

Backend checks:

```bash
python -m pip install -r requirements-dev.txt
ruff check api src tests main.py
ruff format --check api src tests main.py
python -m pytest --cov=api --cov=src --cov-report=term-missing
```

Frontend checks:

```bash
cd web
npm ci
npm run lint
npm run test
npm run build
```

GitHub Actions runs the same default checks on `main` and `dev` pull requests and pushes. Real model API calls and desktop PowerPoint/WPS rendering are intentionally not part of the default CI because they require private keys or host applications that are not available in GitHub runners. CI still validates package-level PPTX structure, object manifests, renderer contracts, and fake-provider reconstruction paths.

## 📋 TODO

- [ ] Upgrade generated PPT images into structured, editable PPT content
- [ ] Support region selection for partial slide editing
- [ ] Add more provider profile templates

## Acknowledgements

The editable PPTX reconstruction design references ideas from:
- [LRriver/slide-alchemy](https://github.com/LRriver/slide-alchemy)
- [ningzimu/image-to-editable-ppt-skill](https://github.com/ningzimu/image-to-editable-ppt-skill)

## 📄 License

Apache License 2.0
