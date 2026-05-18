# Project Persistence And Multi-Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `currentProject` localStorage recovery path with robust local multi-project persistence that keeps source content, design outline, page designs, generated slide images, edit history, and recovery metadata across refreshes, browser restarts, and multiple PPT sessions.

**Architecture:** Use IndexedDB as the durable project database and asset store, with localStorage only for small preferences such as the active project id and UI settings. Persist project metadata and image assets atomically enough that the app never saves slide records pointing at missing images; generation runs should keep the last complete deck until a new run produces a replacement. Add a project library UI so users can create, open, rename, duplicate, and delete multiple PPT sessions without refreshing the page.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, fast-check, fake-indexeddb, IndexedDB browser APIs, existing FastAPI backend for upload/generate/edit/export.

---

## File Structure

Create or modify these files:

- Create `web/src/services/projectStore.ts`: IndexedDB repository for projects, assets, active project id, migration helpers, integrity checks.
- Create `web/src/services/projectStore.test-utils.ts`: small test helpers for resetting IndexedDB/localStorage and building sample project records.
- Create `web/src/components/__tests__/ProjectStore.property.test.ts`: persistence, migration, multi-project, and missing-asset tests.
- Create `web/src/hooks/useProjectManager.ts`: loads project list, active project, create/open/rename/duplicate/delete project actions.
- Create `web/src/components/ProjectLibrary.tsx`: user-facing project list and actions.
- Create `web/src/components/__tests__/ProjectLibrary.test.tsx`: UI behavior for project list actions.
- Modify `web/src/types/index.ts`: add `ProjectRecord`, `WorkflowState`, `SlideAssetRef`, `ProjectSummary`, `ProjectStatus`, and extend `Slide`.
- Modify `web/src/services/storageService.ts`: keep legacy load/migration facade; delegate current durable project reads to `projectStore`.
- Modify `web/src/hooks/useStateRestore.ts`: restore active project from IndexedDB with asset hydration and integrity diagnostics.
- Modify `web/src/hooks/useAutoSave.ts`: async debounced project saves with generation-aware snapshots and `pagehide` flushing.
- Modify `web/src/contexts/AppStateContext.tsx`: track `projectId`, `workflow`, `projectStatus`, last complete generation metadata, and ensure file changes clear stale slides.
- Modify `web/src/App.tsx`: wire project manager, project library, workflow persistence, and generation-safe save behavior.
- Modify `web/src/components/DesignWorkflowPanel.tsx`: lift outline/page-design state through props so it persists.
- Modify `web/src/hooks/useGeneration.ts`: record generation run id/status, avoid destroying last complete saved deck, persist partial progress safely.
- Modify `web/src/hooks/useEdit.ts`: persist confirmed edit history in the slide/project record, not only transient edit session state.
- Modify `web/src/components/NewProjectButton.tsx`: create a new project instead of clearing the only project slot.
- Modify `web/src/i18n.ts`: add Chinese/English copy for project library, recovery warnings, and save status.
- Modify `web/src/components/__tests__/StatePersistence.property.test.tsx`: keep legacy migration tests, remove assumptions that only one project exists.
- Modify `README.md` and `README_en.md`: describe multi-project local persistence and browser storage behavior after implementation.

Boundary decision: do not introduce server accounts, remote database, or cloud sync in this change. The durable storage target is the user's local browser profile, matching the current local-first config design.

---

### Task 1: Add Durable Project Types

**Files:**
- Modify: `web/src/types/index.ts`
- Test: `web/src/components/__tests__/ProjectStore.property.test.ts`

- [ ] **Step 1: Write the failing type-level persistence test scaffold**

Create `web/src/components/__tests__/ProjectStore.property.test.ts` with this initial content. It imports names that do not exist yet, so it must fail before implementation.

```tsx
import { describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { ProjectRecord, Slide } from '../../types'
import { buildProjectRecord } from '../../services/projectStore.test-utils'

describe('ProjectStore durable type shape', () => {
  it('builds a project record with workflow and asset-backed slides', () => {
    const slide: Slide = {
      id: 'slide-1',
      pageNumber: 1,
      imageUrl: 'data:image/png;base64,aaa',
      imageBase64: 'aaa',
      prompt: 'A title slide'
    }

    const project: ProjectRecord = buildProjectRecord({
      id: 'project-1',
      title: 'Demo deck',
      fileName: 'L9.md',
      fileContent: '# L9',
      slides: [slide],
      workflow: {
        status: 'prompts_ready',
        outline: {
          title: 'Demo deck',
          user_requirements: 'Make it concise',
          design_style: 'Modern',
          audience: 'Sales',
          slides: [{
            page: 1,
            title: 'Cover',
            narrative_goal: 'Introduce the deck',
            key_points: ['L9'],
            visual_direction: 'Dark vehicle hero'
          }]
        },
        slidePrompts: [{
          page: 1,
          title: 'Cover',
          content_summary: 'A cover page',
          display_content: 'A cover page',
          prompt: 'Generate a cover page'
        }],
        expandedOutlinePages: [1],
        expandedDesignPages: [1],
        error: null
      }
    })

    expect(project.version).toBe(2)
    expect(project.id).toBe('project-1')
    expect(project.workflow.status).toBe('prompts_ready')
    expect(project.slides[0].imageBase64).toBe('aaa')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd web
npm run test -- ProjectStore --run
```

Expected: FAIL with TypeScript errors for missing `ProjectRecord`, `buildProjectRecord`, and `projectStore.test-utils`.

- [ ] **Step 3: Add durable types**

Modify `web/src/types/index.ts`. Keep existing exported interfaces, and add these types near the existing `Slide`, `DeckOutline`, and `ConfirmedSlidePrompt` definitions.

```ts
export type ProjectStatus =
  | 'draft'
  | 'planning'
  | 'prompts_ready'
  | 'generating'
  | 'generated'
  | 'editing'
  | 'error'

export interface SlideAssetRef {
  key: string
  mimeType: string
  byteLength: number
  sha256?: string
}

export interface Slide {
  id: string
  pageNumber: number
  imageUrl: string
  imageBase64?: string
  imageStorageKey?: string
  imageAsset?: SlideAssetRef
  prompt: string
  editHistory?: EditHistoryItem[]
  updatedAt?: number
}

export interface WorkflowState {
  status:
    | 'idle'
    | 'outline_loading'
    | 'outline_ready'
    | 'prompts_loading'
    | 'prompts_ready'
    | 'error'
  outline: DeckOutline | null
  slidePrompts: ConfirmedSlidePrompt[]
  expandedOutlinePages: number[]
  expandedDesignPages: number[]
  error: string | null
}

export interface ProjectSummary {
  id: string
  title: string
  fileName: string
  slideCount: number
  status: ProjectStatus
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
}

export interface ProjectRecord {
  version: 2
  id: string
  title: string
  fileName: string
  fileContent: string
  slides: Slide[]
  generationConfig: GenerationConfig
  workflow: WorkflowState
  status: ProjectStatus
  generationRunId: string | null
  lastCompletedSlides: Slide[]
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
}
```

If the file already has an exported `Slide` interface, replace that interface with the extended version above instead of duplicating it.

- [ ] **Step 4: Add test helper**

Create `web/src/services/projectStore.test-utils.ts` with this content.

```ts
import {
  ConfirmedSlidePrompt,
  DeckOutline,
  GenerationConfig,
  ProjectRecord,
  ProjectStatus,
  Slide,
  WorkflowState
} from '../types'

export const TEST_GENERATION_CONFIG: GenerationConfig = {
  pageCount: 1,
  quality: '1K',
  aspectRatio: '16:9',
  language: '中文',
  style: '现代简约商务风格',
  targetAudience: '专业人士',
  userRequirements: ''
}

export const EMPTY_WORKFLOW_STATE: WorkflowState = {
  status: 'idle',
  outline: null,
  slidePrompts: [],
  expandedOutlinePages: [],
  expandedDesignPages: [],
  error: null
}

export function buildDeckOutline(overrides: Partial<DeckOutline> = {}): DeckOutline {
  return {
    title: 'Demo deck',
    user_requirements: 'Make it concise',
    design_style: 'Modern',
    audience: 'Sales',
    slides: [{
      page: 1,
      title: 'Cover',
      narrative_goal: 'Introduce the deck',
      key_points: ['L9'],
      visual_direction: 'Dark vehicle hero'
    }],
    ...overrides
  }
}

export function buildSlidePrompt(overrides: Partial<ConfirmedSlidePrompt> = {}): ConfirmedSlidePrompt {
  return {
    page: 1,
    title: 'Cover',
    content_summary: 'A cover page',
    display_content: 'A cover page',
    prompt: 'Generate a cover page',
    ...overrides
  }
}

export function buildSlide(overrides: Partial<Slide> = {}): Slide {
  return {
    id: 'slide-1',
    pageNumber: 1,
    imageUrl: 'data:image/png;base64,aaa',
    imageBase64: 'aaa',
    prompt: 'Generate a cover page',
    ...overrides
  }
}

export function buildProjectRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  const now = 1712131200000
  const slides = overrides.slides || [buildSlide()]
  const status: ProjectStatus = overrides.status || 'generated'
  return {
    version: 2,
    id: overrides.id || 'project-1',
    title: overrides.title || 'Demo deck',
    fileName: overrides.fileName || 'L9.md',
    fileContent: overrides.fileContent || '# L9',
    slides,
    generationConfig: overrides.generationConfig || TEST_GENERATION_CONFIG,
    workflow: overrides.workflow || EMPTY_WORKFLOW_STATE,
    status,
    generationRunId: overrides.generationRunId ?? null,
    lastCompletedSlides: overrides.lastCompletedSlides || slides,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    lastOpenedAt: overrides.lastOpenedAt || now
  }
}

export async function resetProjectStoreForTests(): Promise<void> {
  localStorage.clear()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('aippt_projects')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => resolve()
  })
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
cd web
npm run test -- ProjectStore --run
```

Expected: PASS for the single type-shape test.

- [ ] **Step 6: Commit**

```bash
git add web/src/types/index.ts web/src/services/projectStore.test-utils.ts web/src/components/__tests__/ProjectStore.property.test.ts
git commit -m "feat: add durable project persistence types"
```

---

### Task 2: Implement IndexedDB Project Store

**Files:**
- Create: `web/src/services/projectStore.ts`
- Modify: `web/src/components/__tests__/ProjectStore.property.test.ts`
- Modify: `web/src/services/projectStore.test-utils.ts`

- [ ] **Step 1: Replace the ProjectStore test with persistence tests**

Replace `web/src/components/__tests__/ProjectStore.property.test.ts` with this content.

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fc from 'fast-check'
import 'fake-indexeddb/auto'
import {
  clearActiveProjectId,
  deleteProject,
  duplicateProject,
  getActiveProjectId,
  getProject,
  getProjectSummaries,
  hydrateProjectImages,
  renameProject,
  saveProjectRecord,
  setActiveProjectId,
  verifyProjectIntegrity
} from '../../services/projectStore'
import {
  buildProjectRecord,
  buildSlide,
  resetProjectStoreForTests,
  TEST_GENERATION_CONFIG
} from '../../services/projectStore.test-utils'
import { ProjectRecord } from '../../types'

describe('ProjectStore durable persistence', () => {
  beforeEach(async () => {
    await resetProjectStoreForTests()
  })

  it('saves and restores a project with slide images after a browser-like reload', async () => {
    const project = buildProjectRecord({
      id: 'project-a',
      title: 'AIPPT Demo',
      slides: [
        buildSlide({
          id: 'slide-1',
          pageNumber: 1,
          imageUrl: 'data:image/png;base64,aaa',
          imageBase64: 'aaa'
        }),
        buildSlide({
          id: 'slide-2',
          pageNumber: 2,
          imageUrl: 'data:image/png;base64,bbb',
          imageBase64: 'bbb'
        })
      ]
    })

    await saveProjectRecord(project)
    const stored = await getProject('project-a')
    expect(stored?.slides[0].imageBase64).toBeUndefined()
    expect(stored?.slides[0].imageUrl).toBe('')
    expect(stored?.slides[0].imageAsset?.key).toBe('project-a:slide-1:current')

    const hydrated = await hydrateProjectImages(stored!)
    expect(hydrated.slides[0].imageBase64).toBe('aaa')
    expect(hydrated.slides[0].imageUrl).toBe('data:image/png;base64,aaa')
    expect(hydrated.slides[1].imageBase64).toBe('bbb')
  })

  it('keeps multiple projects and opens the requested active project', async () => {
    await saveProjectRecord(buildProjectRecord({ id: 'project-a', title: 'First' }))
    await saveProjectRecord(buildProjectRecord({ id: 'project-b', title: 'Second', fileName: 'next.md' }))
    await setActiveProjectId('project-b')

    const summaries = await getProjectSummaries()
    expect(summaries.map(item => item.id).sort()).toEqual(['project-a', 'project-b'])
    expect(await getActiveProjectId()).toBe('project-b')

    const active = await getProject('project-b')
    expect(active?.title).toBe('Second')
  })

  it('renames, duplicates, and deletes projects without affecting other projects', async () => {
    await saveProjectRecord(buildProjectRecord({ id: 'project-a', title: 'First' }))
    await saveProjectRecord(buildProjectRecord({ id: 'project-b', title: 'Second' }))
    await renameProject('project-a', 'Renamed')
    const copy = await duplicateProject('project-a')
    await deleteProject('project-b')

    const summaries = await getProjectSummaries()
    expect(summaries.map(item => item.title).sort()).toEqual(['Renamed', 'Renamed copy'])
    expect(copy.id).not.toBe('project-a')
    expect(await getProject('project-b')).toBeNull()
  })

  it('reports missing image assets instead of silently claiming full recovery', async () => {
    const project = buildProjectRecord({
      id: 'project-a',
      slides: [buildSlide({ id: 'slide-1', imageBase64: '', imageUrl: '', imageAsset: {
        key: 'project-a:slide-1:current',
        mimeType: 'image/png',
        byteLength: 3
      } })]
    })
    await saveProjectRecord(project)

    const stored = await getProject('project-a')
    const integrity = await verifyProjectIntegrity(stored!)
    expect(integrity.ok).toBe(false)
    expect(integrity.missingAssetKeys).toEqual(['project-a:slide-1:current'])
  })

  it('does not save a compact slide reference when asset saving fails', async () => {
    const project = buildProjectRecord({
      id: 'project-a',
      slides: [buildSlide({ id: 'slide-1', imageBase64: 'aaa' })]
    })
    const openSpy = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      throw new DOMException('IndexedDB unavailable', 'InvalidStateError')
    })

    await expect(saveProjectRecord(project)).rejects.toThrow('IndexedDB unavailable')
    expect(await getProject('project-a')).toBeNull()
    openSpy.mockRestore()
  })

  it('persists arbitrary small project metadata without mutating source fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.string({ minLength: 1, maxLength: 1000 }),
        async (id, title, content) => {
          await resetProjectStoreForTests()
          const project: ProjectRecord = buildProjectRecord({
            id,
            title,
            fileContent: content,
            slides: [],
            lastCompletedSlides: [],
            generationConfig: TEST_GENERATION_CONFIG
          })
          await saveProjectRecord(project)
          const restored = await getProject(id)
          expect(restored?.id).toBe(id)
          expect(restored?.title).toBe(title)
          expect(restored?.fileContent).toBe(content)
        }
      ),
      { numRuns: 30 }
    )
  })

  it('clears the active project id without deleting saved projects', async () => {
    await saveProjectRecord(buildProjectRecord({ id: 'project-a' }))
    await setActiveProjectId('project-a')
    await clearActiveProjectId()
    expect(await getActiveProjectId()).toBeNull()
    expect(await getProject('project-a')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd web
npm run test -- ProjectStore --run
```

Expected: FAIL because `projectStore.ts` does not exist.

- [ ] **Step 3: Create IndexedDB store implementation**

Create `web/src/services/projectStore.ts` with this content.

```ts
import { ProjectRecord, ProjectSummary, Slide } from '../types'

const DB_NAME = 'aippt_projects'
const DB_VERSION = 1
const PROJECT_STORE = 'projects'
const ASSET_STORE = 'assets'
const ACTIVE_PROJECT_KEY = 'aippt_active_project_id'

interface AssetRecord {
  key: string
  projectId: string
  slideId: string
  mimeType: string
  base64: string
  byteLength: number
  createdAt: number
}

export interface ProjectIntegrityReport {
  ok: boolean
  missingAssetKeys: string[]
}

function ensureIndexedDb(): void {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available')
  }
}

function openDb(): Promise<IDBDatabase> {
  ensureIndexedDb()
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        const projects = db.createObjectStore(PROJECT_STORE, { keyPath: 'id' })
        projects.createIndex('updatedAt', 'updatedAt')
        projects.createIndex('lastOpenedAt', 'lastOpenedAt')
      }
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        const assets = db.createObjectStore(ASSET_STORE, { keyPath: 'key' })
        assets.createIndex('projectId', 'projectId')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Failed to open project store'))
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'))
  })
}

function extractBase64(slide: Slide): string {
  if (slide.imageBase64) return slide.imageBase64
  const match = slide.imageUrl?.match(/^data:([^;]+);base64,(.+)$/)
  return match?.[2] || ''
}

function extractMimeType(slide: Slide): string {
  const match = slide.imageUrl?.match(/^data:([^;]+);base64,/)
  return match?.[1] || slide.imageAsset?.mimeType || 'image/png'
}

function assetKey(projectId: string, slideId: string): string {
  return `${projectId}:${slideId}:current`
}

function compactSlides(projectId: string, slides: Slide[]): { slides: Slide[]; assets: AssetRecord[] } {
  const now = Date.now()
  const assets: AssetRecord[] = []
  const compact = slides.map((slide) => {
    const base64 = extractBase64(slide)
    if (!base64) {
      return {
        ...slide,
        imageBase64: undefined
      }
    }
    const key = assetKey(projectId, slide.id)
    const byteLength = Math.ceil((base64.length * 3) / 4)
    assets.push({
      key,
      projectId,
      slideId: slide.id,
      mimeType: extractMimeType(slide),
      base64,
      byteLength,
      createdAt: now
    })
    return {
      ...slide,
      imageUrl: '',
      imageBase64: undefined,
      imageStorageKey: key,
      imageAsset: {
        key,
        mimeType: extractMimeType(slide),
        byteLength
      }
    }
  })
  return { slides: compact, assets }
}

function summarize(project: ProjectRecord): ProjectSummary {
  return {
    id: project.id,
    title: project.title,
    fileName: project.fileName,
    slideCount: project.slides.length,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastOpenedAt: project.lastOpenedAt
  }
}

export function createProjectId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `project-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export async function saveProjectRecord(project: ProjectRecord): Promise<ProjectRecord> {
  const db = await openDb()
  try {
    const { slides, assets } = compactSlides(project.id, project.slides)
    const lastCompleted = compactSlides(project.id, project.lastCompletedSlides).slides
    const compactProject: ProjectRecord = {
      ...project,
      slides,
      lastCompletedSlides: lastCompleted,
      updatedAt: Date.now()
    }

    const transaction = db.transaction([PROJECT_STORE, ASSET_STORE], 'readwrite')
    const projectStore = transaction.objectStore(PROJECT_STORE)
    const assetStore = transaction.objectStore(ASSET_STORE)
    for (const asset of assets) {
      assetStore.put(asset)
    }
    projectStore.put(compactProject)
    await transactionDone(transaction)
    return compactProject
  } finally {
    db.close()
  }
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  const db = await openDb()
  try {
    const transaction = db.transaction(PROJECT_STORE, 'readonly')
    const store = transaction.objectStore(PROJECT_STORE)
    const project = await requestToPromise<ProjectRecord | undefined>(store.get(id))
    return project || null
  } finally {
    db.close()
  }
}

export async function getProjectSummaries(): Promise<ProjectSummary[]> {
  const db = await openDb()
  try {
    const transaction = db.transaction(PROJECT_STORE, 'readonly')
    const store = transaction.objectStore(PROJECT_STORE)
    const projects = await requestToPromise<ProjectRecord[]>(store.getAll())
    return projects
      .map(summarize)
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  } finally {
    db.close()
  }
}

async function getAsset(key: string): Promise<AssetRecord | null> {
  const db = await openDb()
  try {
    const transaction = db.transaction(ASSET_STORE, 'readonly')
    const store = transaction.objectStore(ASSET_STORE)
    const asset = await requestToPromise<AssetRecord | undefined>(store.get(key))
    return asset || null
  } finally {
    db.close()
  }
}

export async function hydrateProjectImages(project: ProjectRecord): Promise<ProjectRecord> {
  const hydrateSlides = async (slides: Slide[]): Promise<Slide[]> => Promise.all(slides.map(async (slide) => {
    if (slide.imageBase64 || slide.imageUrl) return slide
    const key = slide.imageAsset?.key || slide.imageStorageKey
    if (!key) return slide
    const asset = await getAsset(key)
    if (!asset) return slide
    return {
      ...slide,
      imageBase64: asset.base64,
      imageUrl: `data:${asset.mimeType};base64,${asset.base64}`,
      imageAsset: {
        key: asset.key,
        mimeType: asset.mimeType,
        byteLength: asset.byteLength
      }
    }
  }))

  return {
    ...project,
    slides: await hydrateSlides(project.slides),
    lastCompletedSlides: await hydrateSlides(project.lastCompletedSlides)
  }
}

export async function verifyProjectIntegrity(project: ProjectRecord): Promise<ProjectIntegrityReport> {
  const keys = project.slides
    .map(slide => slide.imageAsset?.key || slide.imageStorageKey)
    .filter((key): key is string => Boolean(key))
  const missingAssetKeys: string[] = []
  for (const key of keys) {
    const asset = await getAsset(key)
    if (!asset) missingAssetKeys.push(key)
  }
  return {
    ok: missingAssetKeys.length === 0,
    missingAssetKeys
  }
}

export async function renameProject(id: string, title: string): Promise<ProjectRecord> {
  const project = await getProject(id)
  if (!project) throw new Error(`Project not found: ${id}`)
  const updated = {
    ...project,
    title,
    updatedAt: Date.now()
  }
  return saveProjectRecord(updated)
}

export async function duplicateProject(id: string): Promise<ProjectRecord> {
  const project = await getProject(id)
  if (!project) throw new Error(`Project not found: ${id}`)
  const hydrated = await hydrateProjectImages(project)
  const now = Date.now()
  const copy: ProjectRecord = {
    ...hydrated,
    id: createProjectId(),
    title: `${hydrated.title} copy`,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now
  }
  return saveProjectRecord(copy)
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb()
  try {
    const transaction = db.transaction([PROJECT_STORE, ASSET_STORE], 'readwrite')
    transaction.objectStore(PROJECT_STORE).delete(id)
    const assetStore = transaction.objectStore(ASSET_STORE)
    const index = assetStore.index('projectId')
    const request = index.openCursor(IDBKeyRange.only(id))
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }
    await transactionDone(transaction)
    if (await getActiveProjectId() === id) {
      await clearActiveProjectId()
    }
  } finally {
    db.close()
  }
}

export async function setActiveProjectId(id: string): Promise<void> {
  localStorage.setItem(ACTIVE_PROJECT_KEY, id)
}

export async function getActiveProjectId(): Promise<string | null> {
  return localStorage.getItem(ACTIVE_PROJECT_KEY)
}

export async function clearActiveProjectId(): Promise<void> {
  localStorage.removeItem(ACTIVE_PROJECT_KEY)
}
```

- [ ] **Step 4: Update test reset helper to delete new database**

Ensure `web/src/services/projectStore.test-utils.ts` deletes `aippt_projects`. The helper already does this if Task 1 was followed. If it still deletes `aippt_slide_images`, replace the helper body with:

```ts
export async function resetProjectStoreForTests(): Promise<void> {
  localStorage.clear()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('aippt_projects')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => resolve()
  })
}
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
cd web
npm run test -- ProjectStore --run
```

Expected: PASS for all ProjectStore tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/services/projectStore.ts web/src/services/projectStore.test-utils.ts web/src/components/__tests__/ProjectStore.property.test.ts
git commit -m "feat: add indexeddb project store"
```

---

### Task 3: Migrate Legacy Single-Project State

**Files:**
- Modify: `web/src/services/storageService.ts`
- Modify: `web/src/hooks/useStateRestore.ts`
- Modify: `web/src/components/__tests__/StatePersistence.property.test.tsx`

- [ ] **Step 1: Add failing legacy migration test**

Append this test inside the existing `describe('State Persistence Property Tests', ...)` block in `web/src/components/__tests__/StatePersistence.property.test.tsx`.

```tsx
  it('migrates legacy currentProject into the durable active project store', async () => {
    const legacySlide: Slide = {
      id: 'slide-1',
      pageNumber: 1,
      imageUrl: 'data:image/png;base64,legacy',
      imageBase64: 'legacy',
      prompt: 'legacy prompt'
    }

    localStorage.setItem('aippt_persisted_state', JSON.stringify({
      version: 1,
      apiConfig: { apiKey: '', baseUrl: '' },
      currentProject: {
        fileContent: '# legacy',
        fileName: 'legacy.md',
        slides: [legacySlide],
        generationConfig
      }
    }))

    const restored = await StorageService.loadActiveProjectWithMigration()
    expect(restored?.fileName).toBe('legacy.md')
    expect(restored?.slides[0].imageBase64).toBe('legacy')
    expect(localStorage.getItem('aippt_persisted_state')).toBeNull()
  })
```

Add this constant near the top of the test file if it does not already exist:

```ts
const generationConfig: GenerationConfig = {
  pageCount: 1,
  quality: '1K',
  aspectRatio: '16:9'
}
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd web
npm run test -- StatePersistence --run
```

Expected: FAIL because `StorageService.loadActiveProjectWithMigration` does not exist.

- [ ] **Step 3: Add migration facade**

Modify `web/src/services/storageService.ts` by importing project store helpers:

```ts
import {
  createProjectId,
  getActiveProjectId,
  getProject,
  hydrateProjectImages,
  saveProjectRecord,
  setActiveProjectId
} from './projectStore'
import { ProjectRecord, WorkflowState } from '../types'
```

Add these constants and helper methods inside `StorageService` before `saveState`:

```ts
  private static legacyStateKey(): string {
    return STORAGE_KEYS.STATE
  }

  private static emptyWorkflow(): WorkflowState {
    return {
      status: 'idle',
      outline: null,
      slidePrompts: [],
      expandedOutlinePages: [],
      expandedDesignPages: [],
      error: null
    }
  }

  private static legacyProjectToRecord(project: NonNullable<PersistedState['currentProject']>): ProjectRecord {
    const now = Date.now()
    const title = project.fileName ? project.fileName.replace(/\.[^.]+$/, '') : 'Untitled project'
    return {
      version: 2,
      id: createProjectId(),
      title,
      fileName: project.fileName,
      fileContent: project.fileContent,
      slides: project.slides,
      generationConfig: project.generationConfig,
      workflow: StorageService.emptyWorkflow(),
      status: project.slides.length > 0 ? 'generated' : 'draft',
      generationRunId: null,
      lastCompletedSlides: project.slides,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now
    }
  }
```

Add this public method inside `StorageService`:

```ts
  static async loadActiveProjectWithMigration(): Promise<ProjectRecord | null> {
    const activeId = await getActiveProjectId()
    if (activeId) {
      const active = await getProject(activeId)
      if (active) {
        return hydrateProjectImages(active)
      }
    }

    const legacy = StorageService.loadProject()
    if (!legacy) {
      return null
    }

    const project = StorageService.legacyProjectToRecord(legacy)
    const saved = await saveProjectRecord(project)
    await setActiveProjectId(saved.id)
    localStorage.removeItem(StorageService.legacyStateKey())
    return hydrateProjectImages(saved)
  }
```

Export it at the bottom:

```ts
export const loadActiveProjectWithMigration = StorageService.loadActiveProjectWithMigration
```

- [ ] **Step 4: Update state restore hook**

In `web/src/hooks/useStateRestore.ts`, replace:

```ts
const project = await StorageService.loadProjectWithImages()
```

with:

```ts
const project = await StorageService.loadActiveProjectWithMigration()
```

Update `RestoredProject` to include project id and workflow:

```ts
export interface RestoredProject {
  projectId: string
  fileContent: string
  fileName: string
  slides: Slide[]
  generationConfig: GenerationConfig
  workflow: WorkflowState
}
```

When setting restored project, use:

```ts
setRestoredProject({
  projectId: project.id,
  fileContent: project.fileContent,
  fileName: project.fileName,
  slides: project.slides,
  generationConfig: project.generationConfig,
  workflow: project.workflow
})
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd web
npm run test -- StatePersistence ProjectStore --run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/services/storageService.ts web/src/hooks/useStateRestore.ts web/src/components/__tests__/StatePersistence.property.test.tsx
git commit -m "feat: migrate legacy project state"
```

---

### Task 4: Make App State Project-Aware And Clear Stale Slides On New Files

**Files:**
- Modify: `web/src/contexts/AppStateContext.tsx`
- Modify: `web/src/App.tsx`
- Create: `web/src/components/__tests__/AppStatePersistence.test.tsx`

- [ ] **Step 1: Write failing reducer behavior tests**

Create `web/src/components/__tests__/AppStatePersistence.test.tsx` with:

```tsx
import { describe, expect, it } from 'vitest'
import { appReducerForTests, initialAppStateForTests } from '../../contexts/AppStateContext'
import { EMPTY_WORKFLOW_STATE, TEST_GENERATION_CONFIG, buildSlide } from '../../services/projectStore.test-utils'

describe('App state project persistence behavior', () => {
  it('clears stale slides and workflow when a different file is selected', () => {
    const stateWithSlides = {
      ...initialAppStateForTests,
      projectId: 'project-a',
      fileContent: '# old',
      fileName: 'old.md',
      slides: [buildSlide()],
      workflow: {
        ...EMPTY_WORKFLOW_STATE,
        status: 'prompts_ready' as const,
        slidePrompts: [{
          page: 1,
          title: 'Old',
          content_summary: 'Old',
          display_content: 'Old',
          prompt: 'Old'
        }]
      }
    }

    const next = appReducerForTests(stateWithSlides, {
      type: 'SET_FILE_CONTENT',
      payload: { content: '# new', name: 'new.md' }
    })

    expect(next.fileName).toBe('new.md')
    expect(next.slides).toEqual([])
    expect(next.selectedSlideId).toBeNull()
    expect(next.workflow).toEqual(EMPTY_WORKFLOW_STATE)
    expect(next.status).toBe('draft')
  })

  it('keeps last completed slides when a new generation starts', () => {
    const completedSlides = [buildSlide()]
    const next = appReducerForTests({
      ...initialAppStateForTests,
      fileContent: '# L9',
      fileName: 'L9.md',
      slides: completedSlides,
      lastCompletedSlides: completedSlides,
      generationConfig: TEST_GENERATION_CONFIG,
      status: 'generated'
    }, { type: 'START_GENERATION', payload: { runId: 'run-1' } })

    expect(next.status).toBe('generating')
    expect(next.generationRunId).toBe('run-1')
    expect(next.lastCompletedSlides).toEqual(completedSlides)
    expect(next.slides).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd web
npm run test -- AppStatePersistence --run
```

Expected: FAIL because test exports and state fields do not exist.

- [ ] **Step 3: Extend app state**

Modify `web/src/contexts/AppStateContext.tsx`.

Add imports:

```ts
import { ProjectStatus, WorkflowState } from '../types'
import { EMPTY_WORKFLOW_STATE } from '../services/projectStore.test-utils'
```

Do not keep the test utility import in production code. Instead, create a local function with the same shape:

```ts
function createEmptyWorkflowState(): WorkflowState {
  return {
    status: 'idle',
    outline: null,
    slidePrompts: [],
    expandedOutlinePages: [],
    expandedDesignPages: [],
    error: null
  }
}
```

Extend `AppState`:

```ts
  projectId: string | null
  status: ProjectStatus
  workflow: WorkflowState
  generationRunId: string | null
  lastCompletedSlides: Slide[]
```

Update `initialState`:

```ts
  projectId: null,
  status: 'draft',
  workflow: createEmptyWorkflowState(),
  generationRunId: null,
  lastCompletedSlides: [],
```

Update `RestoreStatePayload`:

```ts
interface RestoreStatePayload {
  projectId: string
  fileContent: string
  fileName: string
  slides: Slide[]
  generationConfig: GenerationConfig
  workflow: WorkflowState
  status?: ProjectStatus
  lastCompletedSlides?: Slide[]
}
```

Update action types:

```ts
  | { type: 'START_GENERATION'; payload: { runId: string } }
  | { type: 'SET_WORKFLOW'; payload: WorkflowState }
  | { type: 'SET_PROJECT_ID'; payload: string | null }
```

Update reducer cases:

```ts
    case 'SET_FILE':
      return {
        ...state,
        uploadedFile: action.payload.file,
        fileContent: action.payload.content,
        fileName: action.payload.name,
        slides: [],
        lastCompletedSlides: [],
        selectedSlideId: null,
        editingSlide: null,
        workflow: createEmptyWorkflowState(),
        status: 'draft',
        generationRunId: null
      }

    case 'SET_FILE_CONTENT':
      return {
        ...state,
        uploadedFile: null,
        fileContent: action.payload.content,
        fileName: action.payload.name,
        slides: [],
        lastCompletedSlides: [],
        selectedSlideId: null,
        editingSlide: null,
        workflow: createEmptyWorkflowState(),
        status: 'draft',
        generationRunId: null
      }

    case 'START_GENERATION':
      return {
        ...state,
        isGenerating: true,
        status: 'generating',
        generationRunId: action.payload.runId,
        generationProgress: {
          current: 0,
          total: 0,
          status: 'started',
          message: '开始生成 PPT'
        },
        generationError: null,
        slides: []
      }

    case 'COMPLETE_GENERATION':
      return {
        ...state,
        isGenerating: false,
        status: 'generated',
        generationRunId: null,
        lastCompletedSlides: state.slides,
        generationProgress: {
          ...state.generationProgress,
          status: 'completed',
          message: 'PPT 生成完成'
        }
      }

    case 'GENERATION_ERROR':
      return {
        ...state,
        isGenerating: false,
        status: 'error',
        generationError: action.payload
      }

    case 'SET_WORKFLOW':
      return {
        ...state,
        workflow: action.payload,
        status: action.payload.status === 'prompts_ready' ? 'prompts_ready' : state.status
      }

    case 'SET_PROJECT_ID':
      return {
        ...state,
        projectId: action.payload
      }
```

Update `RESTORE_STATE`:

```ts
    case 'RESTORE_STATE':
      return {
        ...state,
        projectId: action.payload.projectId,
        uploadedFile: null,
        fileContent: action.payload.fileContent,
        fileName: action.payload.fileName,
        slides: dedupeSlides(action.payload.slides),
        lastCompletedSlides: dedupeSlides(action.payload.lastCompletedSlides || action.payload.slides),
        generationConfig: action.payload.generationConfig,
        workflow: action.payload.workflow,
        status: action.payload.status || (action.payload.slides.length > 0 ? 'generated' : 'draft'),
        generationRunId: null,
        generationProgress: {
          current: action.payload.slides.length,
          total: action.payload.slides.length,
          status: action.payload.slides.length > 0 ? 'completed' : '',
          message: action.payload.slides.length > 0 ? '已恢复之前的会话' : ''
        }
      }
```

Update context type and provider methods:

```ts
  startGeneration: (runId: string) => void
  setWorkflow: (workflow: WorkflowState) => void
  setProjectId: (id: string | null) => void
```

Implement methods:

```ts
  const startGeneration = useCallback((runId: string) => {
    dispatch({ type: 'START_GENERATION', payload: { runId } })
  }, [])

  const setWorkflow = useCallback((workflow: WorkflowState) => {
    dispatch({ type: 'SET_WORKFLOW', payload: workflow })
  }, [])

  const setProjectId = useCallback((id: string | null) => {
    dispatch({ type: 'SET_PROJECT_ID', payload: id })
  }, [])
```

Export reducer helpers at the bottom:

```ts
export const appReducerForTests = appReducer
export const initialAppStateForTests = initialState
```

- [ ] **Step 4: Update generation hook call site**

In `web/src/hooks/useGeneration.ts`, replace:

```ts
startGenerationState()
```

with:

```ts
const runId = `run-${Date.now()}-${Math.random().toString(16).slice(2)}`
startGenerationState(runId)
```

- [ ] **Step 5: Update restore call site**

In `web/src/App.tsx`, update `restoreState` payload:

```ts
restoreState({
  projectId: restoredProject.projectId,
  fileContent: restoredProject.fileContent,
  fileName: restoredProject.fileName,
  slides: restoredProject.slides,
  generationConfig: restoredProject.generationConfig,
  workflow: restoredProject.workflow
})
```

- [ ] **Step 6: Run tests**

Run:

```bash
cd web
npm run test -- AppStatePersistence --run
npm run test -- StatePersistence --run
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/contexts/AppStateContext.tsx web/src/hooks/useGeneration.ts web/src/App.tsx web/src/components/__tests__/AppStatePersistence.test.tsx
git commit -m "fix: make app state project-aware"
```

---

### Task 5: Persist Design Workflow State

**Files:**
- Modify: `web/src/components/DesignWorkflowPanel.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/__tests__/DesignWorkflowPanel.test.tsx`

- [ ] **Step 1: Add failing controlled-workflow test**

Append this test to `web/src/components/__tests__/DesignWorkflowPanel.test.tsx`.

```tsx
it('renders a restored outline and page designs from controlled workflow state', () => {
  const onWorkflowChange = vi.fn()
  const onPromptsReady = vi.fn()
  const onClearPrompts = vi.fn()

  render(
    <DesignWorkflowPanel
      fileContent="# L9"
      fullApiConfig={mockFullApiConfig}
      generationConfig={mockGenerationConfig}
      confirmedPrompts={[{
        page: 1,
        title: 'Restored page',
        content_summary: 'Restored summary',
        display_content: 'Restored display',
        prompt: 'Restored prompt'
      }]}
      workflow={{
        status: 'prompts_ready',
        outline: {
          title: 'Restored outline',
          user_requirements: 'Restored requirements',
          design_style: 'Restored style',
          audience: 'Restored audience',
          slides: [{
            page: 1,
            title: 'Restored page',
            narrative_goal: 'Restored goal',
            key_points: ['Point A'],
            visual_direction: 'Restored visual'
          }]
        },
        slidePrompts: [{
          page: 1,
          title: 'Restored page',
          content_summary: 'Restored summary',
          display_content: 'Restored display',
          prompt: 'Restored prompt'
        }],
        expandedOutlinePages: [],
        expandedDesignPages: [],
        error: null
      }}
      onWorkflowChange={onWorkflowChange}
      onPromptsReady={onPromptsReady}
      onClearPrompts={onClearPrompts}
    />
  )

  expect(screen.getByDisplayValue('Restored outline')).toBeInTheDocument()
  expect(screen.getByText('Restored page')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd web
npm run test -- DesignWorkflowPanel --run
```

Expected: FAIL because `workflow` and `onWorkflowChange` props do not exist.

- [ ] **Step 3: Make workflow controlled**

In `web/src/components/DesignWorkflowPanel.tsx`, update imports:

```ts
import { ConfirmedSlidePrompt, DeckOutline, FullApiConfig, GenerationConfig, WorkflowState } from '../types'
```

Update props:

```ts
interface DesignWorkflowPanelProps {
  fileContent: string
  fullApiConfig: FullApiConfig
  generationConfig: GenerationConfig
  confirmedPrompts: ConfirmedSlidePrompt[] | null
  workflow: WorkflowState
  onWorkflowChange: (workflow: WorkflowState) => void
  onPromptsReady: (prompts: ConfirmedSlidePrompt[]) => void
  onClearPrompts: () => void
  children?: ReactNode
}
```

Replace internal state declarations:

```ts
  const [isOpen, setIsOpen] = useState(true)
  const status = workflow.status
  const outline = workflow.outline
  const slidePrompts = workflow.slidePrompts
  const expandedOutlinePages = useMemo(() => new Set(workflow.expandedOutlinePages), [workflow.expandedOutlinePages])
  const expandedDesignPages = useMemo(() => new Set(workflow.expandedDesignPages), [workflow.expandedDesignPages])
  const error = workflow.error
```

Add helper:

```ts
  const updateWorkflow = useCallback((updates: Partial<WorkflowState>) => {
    onWorkflowChange({
      ...workflow,
      ...updates
    })
  }, [onWorkflowChange, workflow])
```

Replace reset effect body with:

```ts
    updateWorkflow({
      status: 'idle',
      outline: null,
      slidePrompts: [],
      expandedOutlinePages: [],
      expandedDesignPages: [],
      error: null
    })
    onClearPrompts()
```

Replace calls:

```ts
setStatus('outline_loading')
setError(null)
```

with:

```ts
updateWorkflow({ status: 'outline_loading', error: null })
```

When outline succeeds, use:

```ts
updateWorkflow({
  outline: nextOutline,
  slidePrompts: [],
  expandedOutlinePages: [],
  expandedDesignPages: [],
  status: 'outline_ready',
  error: null
})
```

When prompts succeed, use:

```ts
updateWorkflow({
  outline: parsedOutline,
  slidePrompts: prompts,
  status: 'prompts_ready',
  error: null
})
```

For dirty outline:

```ts
updateWorkflow({
  slidePrompts: [],
  expandedDesignPages: [],
  status: 'outline_ready'
})
```

For outline updates:

```ts
const updateOutline = (nextOutline: DeckOutline | null) => updateWorkflow({ outline: nextOutline })
```

Use `updateOutline` in `updateOutlineField`, `updateSlideField`, and `updateSlideKeyPoints`.

For toggles, replace local set state with:

```ts
  const toggleOutlinePage = useCallback((page: number) => {
    const next = new Set(workflow.expandedOutlinePages)
    if (next.has(page)) next.delete(page)
    else next.add(page)
    updateWorkflow({ expandedOutlinePages: Array.from(next) })
  }, [updateWorkflow, workflow.expandedOutlinePages])

  const toggleDesignPage = useCallback((page: number) => {
    const next = new Set(workflow.expandedDesignPages)
    if (next.has(page)) next.delete(page)
    else next.add(page)
    updateWorkflow({ expandedDesignPages: Array.from(next) })
  }, [updateWorkflow, workflow.expandedDesignPages])
```

- [ ] **Step 4: Wire App state**

In `web/src/App.tsx`, destructure `setWorkflow` from `useAppState()` and pass:

```tsx
<DesignWorkflowPanel
  fileContent={state.fileContent}
  fullApiConfig={state.fullApiConfig}
  generationConfig={state.generationConfig}
  confirmedPrompts={confirmedSlidePrompts}
  workflow={state.workflow}
  onWorkflowChange={setWorkflow}
  onPromptsReady={handlePromptsReady}
  onClearPrompts={handleClearPrompts}
>
```

Change confirmed prompts state to derive from workflow where possible:

```ts
const [confirmedSlidePrompts, setConfirmedSlidePrompts] = useState<ConfirmedSlidePrompt[] | null>(null)
```

Keep it for this task; a later task removes duplication after persistence is stable.

- [ ] **Step 5: Run tests**

Run:

```bash
cd web
npm run test -- DesignWorkflowPanel AppStatePersistence --run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/DesignWorkflowPanel.tsx web/src/App.tsx web/src/components/__tests__/DesignWorkflowPanel.test.tsx
git commit -m "feat: persist design workflow state"
```

---

### Task 6: Replace Auto-Save With Async Durable Project Saves

**Files:**
- Modify: `web/src/hooks/useAutoSave.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/services/projectStore.ts`
- Create: `web/src/components/__tests__/AutoSavePersistence.test.tsx`

- [ ] **Step 1: Write failing auto-save tests**

Create `web/src/components/__tests__/AutoSavePersistence.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { getProject, hydrateProjectImages } from '../../services/projectStore'
import { buildProjectRecord, buildSlide, resetProjectStoreForTests, TEST_GENERATION_CONFIG, EMPTY_WORKFLOW_STATE } from '../../services/projectStore.test-utils'
import { useAutoSave } from '../../hooks/useAutoSave'

describe('useAutoSave durable project saves', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    await resetProjectStoreForTests()
  })

  it('saves hydrated slide images to IndexedDB and restores them', async () => {
    const project = buildProjectRecord({
      id: 'project-a',
      slides: [buildSlide({ imageBase64: 'aaa', imageUrl: 'data:image/png;base64,aaa' })]
    })

    renderHook(() => useAutoSave({
      projectId: project.id,
      fileContent: project.fileContent,
      fileName: project.fileName,
      slides: project.slides,
      generationConfig: project.generationConfig,
      workflow: project.workflow,
      status: project.status,
      generationRunId: null,
      lastCompletedSlides: project.lastCompletedSlides,
      enabled: true
    }))

    await act(async () => {
      vi.advanceTimersByTime(1100)
      await Promise.resolve()
    })

    const stored = await getProject('project-a')
    const hydrated = await hydrateProjectImages(stored!)
    expect(hydrated.slides[0].imageBase64).toBe('aaa')
  })

  it('does not overwrite last completed slides during a generating run', async () => {
    const completed = [buildSlide({ id: 'slide-complete', imageBase64: 'done', imageUrl: 'data:image/png;base64,done' })]

    renderHook(() => useAutoSave({
      projectId: 'project-a',
      fileContent: '# L9',
      fileName: 'L9.md',
      slides: [],
      generationConfig: TEST_GENERATION_CONFIG,
      workflow: EMPTY_WORKFLOW_STATE,
      status: 'generating',
      generationRunId: 'run-1',
      lastCompletedSlides: completed,
      enabled: true
    }))

    await act(async () => {
      vi.advanceTimersByTime(1100)
      await Promise.resolve()
    })

    const stored = await getProject('project-a')
    const hydrated = await hydrateProjectImages(stored!)
    expect(hydrated.status).toBe('generating')
    expect(hydrated.slides).toEqual([])
    expect(hydrated.lastCompletedSlides[0].imageBase64).toBe('done')
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd web
npm run test -- AutoSavePersistence --run
```

Expected: FAIL because `useAutoSave` does not accept project fields.

- [ ] **Step 3: Refactor useAutoSave params**

Replace `UseAutoSaveParams` in `web/src/hooks/useAutoSave.ts` with:

```ts
interface UseAutoSaveParams {
  projectId: string | null
  fileContent: string
  fileName: string
  slides: Slide[]
  generationConfig: GenerationConfig
  workflow: WorkflowState
  status: ProjectStatus
  generationRunId: string | null
  lastCompletedSlides: Slide[]
  enabled?: boolean
}
```

Update imports:

```ts
import { ProjectRecord, ProjectStatus, Slide, GenerationConfig, WorkflowState } from '../types'
import { createProjectId, saveProjectRecord, setActiveProjectId } from '../services/projectStore'
```

Replace `performSave` with async-safe implementation:

```ts
  const performSave = useCallback(async () => {
    if (!fileContent && slides.length === 0 && lastCompletedSlides.length === 0) {
      return
    }

    isSavingRef.current = true
    const now = Date.now()
    const id = projectId || createProjectId()
    const title = fileName ? fileName.replace(/\.[^.]+$/, '') : 'Untitled project'
    const project: ProjectRecord = {
      version: 2,
      id,
      title,
      fileName,
      fileContent,
      slides,
      generationConfig,
      workflow,
      status,
      generationRunId,
      lastCompletedSlides,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now
    }

    await saveProjectRecord(project)
    await setActiveProjectId(id)
    lastSavedRef.current = new Date()
    isSavingRef.current = false
  }, [
    fileContent,
    fileName,
    generationConfig,
    generationRunId,
    lastCompletedSlides,
    projectId,
    slides,
    status,
    workflow
  ])
```

Update `saveNow`:

```ts
  const saveNow = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    void performSave().catch((error) => {
      isSavingRef.current = false
      console.error('Failed to auto-save project:', error)
    })
  }, [performSave])
```

Update debounced save callback:

```ts
    timeoutRef.current = setTimeout(() => {
      void performSave().catch((error) => {
        isSavingRef.current = false
        console.error('Failed to auto-save project:', error)
      })
      timeoutRef.current = null
    }, DEBOUNCE_DELAY)
```

Replace `beforeunload` listener with `pagehide` and `visibilitychange`:

```ts
  useEffect(() => {
    const flush = () => {
      if (enabled && (fileContent || slides.length > 0 || lastCompletedSlides.length > 0)) {
        saveNow()
      }
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }

    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled, fileContent, lastCompletedSlides.length, saveNow, slides.length])
```

- [ ] **Step 4: Wire App auto-save**

In `web/src/App.tsx`, replace `useAutoSave` call with:

```ts
  useAutoSave({
    projectId: state.projectId,
    fileContent: state.fileContent,
    fileName: state.fileName,
    slides,
    generationConfig: state.generationConfig,
    workflow: state.workflow,
    status: state.status,
    generationRunId: state.generationRunId,
    lastCompletedSlides: state.lastCompletedSlides,
    enabled: !isRestoring && !showRestoreDialog
  })
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd web
npm run test -- AutoSavePersistence ProjectStore --run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/useAutoSave.ts web/src/App.tsx web/src/components/__tests__/AutoSavePersistence.test.tsx
git commit -m "fix: autosave projects durably"
```

---

### Task 7: Add Project Manager Hook And Project Library UI

**Files:**
- Create: `web/src/hooks/useProjectManager.ts`
- Create: `web/src/components/ProjectLibrary.tsx`
- Create: `web/src/components/__tests__/ProjectLibrary.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/i18n.ts`

- [ ] **Step 1: Write failing ProjectLibrary UI test**

Create `web/src/components/__tests__/ProjectLibrary.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ProjectLibrary from '../ProjectLibrary'
import { UiPreferencesProvider } from '../../contexts/UiPreferencesContext'

function renderLibrary() {
  const onOpenProject = vi.fn()
  const onNewProject = vi.fn()
  const onRenameProject = vi.fn()
  const onDuplicateProject = vi.fn()
  const onDeleteProject = vi.fn()

  render(
    <UiPreferencesProvider>
      <ProjectLibrary
        activeProjectId="project-a"
        projects={[
          {
            id: 'project-a',
            title: 'AIPPT Demo',
            fileName: 'L9.md',
            slideCount: 6,
            status: 'generated',
            createdAt: 1712131200000,
            updatedAt: 1712131300000,
            lastOpenedAt: 1712131300000
          }
        ]}
        onOpenProject={onOpenProject}
        onNewProject={onNewProject}
        onRenameProject={onRenameProject}
        onDuplicateProject={onDuplicateProject}
        onDeleteProject={onDeleteProject}
      />
    </UiPreferencesProvider>
  )

  return { onOpenProject, onNewProject, onRenameProject, onDuplicateProject, onDeleteProject }
}

describe('ProjectLibrary', () => {
  it('shows saved projects and opens a project', () => {
    const { onOpenProject } = renderLibrary()
    expect(screen.getByText('AIPPT Demo')).toBeInTheDocument()
    expect(screen.getByText('6 页')).toBeInTheDocument()
    fireEvent.click(screen.getByText('AIPPT Demo'))
    expect(onOpenProject).toHaveBeenCalledWith('project-a')
  })

  it('creates a new project from the library', () => {
    const { onNewProject } = renderLibrary()
    fireEvent.click(screen.getByRole('button', { name: /新建项目/ }))
    expect(onNewProject).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd web
npm run test -- ProjectLibrary --run
```

Expected: FAIL because component does not exist.

- [ ] **Step 3: Create project manager hook**

Create `web/src/hooks/useProjectManager.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import {
  createProjectId,
  deleteProject,
  duplicateProject,
  getActiveProjectId,
  getProject,
  getProjectSummaries,
  hydrateProjectImages,
  renameProject,
  saveProjectRecord,
  setActiveProjectId
} from '../services/projectStore'
import { GenerationConfig, ProjectRecord, ProjectSummary, WorkflowState } from '../types'

interface CreateProjectInput {
  fileContent?: string
  fileName?: string
  generationConfig: GenerationConfig
  workflow: WorkflowState
}

export function useProjectManager() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(null)
  const [isLoadingProjects, setIsLoadingProjects] = useState(true)

  const refreshProjects = useCallback(async () => {
    setProjects(await getProjectSummaries())
    setActiveProjectIdState(await getActiveProjectId())
  }, [])

  useEffect(() => {
    refreshProjects().finally(() => setIsLoadingProjects(false))
  }, [refreshProjects])

  const openProject = useCallback(async (id: string): Promise<ProjectRecord | null> => {
    const project = await getProject(id)
    if (!project) return null
    const hydrated = await hydrateProjectImages({
      ...project,
      lastOpenedAt: Date.now()
    })
    await saveProjectRecord(hydrated)
    await setActiveProjectId(id)
    await refreshProjects()
    return hydrated
  }, [refreshProjects])

  const createProject = useCallback(async (input: CreateProjectInput): Promise<ProjectRecord> => {
    const now = Date.now()
    const id = createProjectId()
    const fileName = input.fileName || ''
    const project: ProjectRecord = {
      version: 2,
      id,
      title: fileName ? fileName.replace(/\.[^.]+$/, '') : 'Untitled project',
      fileName,
      fileContent: input.fileContent || '',
      slides: [],
      generationConfig: input.generationConfig,
      workflow: input.workflow,
      status: input.fileContent ? 'draft' : 'draft',
      generationRunId: null,
      lastCompletedSlides: [],
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now
    }
    await saveProjectRecord(project)
    await setActiveProjectId(id)
    await refreshProjects()
    return project
  }, [refreshProjects])

  const rename = useCallback(async (id: string, title: string) => {
    await renameProject(id, title)
    await refreshProjects()
  }, [refreshProjects])

  const duplicate = useCallback(async (id: string) => {
    const copy = await duplicateProject(id)
    await setActiveProjectId(copy.id)
    await refreshProjects()
    return copy
  }, [refreshProjects])

  const remove = useCallback(async (id: string) => {
    await deleteProject(id)
    await refreshProjects()
  }, [refreshProjects])

  return {
    projects,
    activeProjectId,
    isLoadingProjects,
    refreshProjects,
    openProject,
    createProject,
    renameProject: rename,
    duplicateProject: duplicate,
    deleteProject: remove
  }
}
```

- [ ] **Step 4: Create ProjectLibrary component**

Create `web/src/components/ProjectLibrary.tsx`:

```tsx
import { ProjectSummary } from '../types'
import { useUiPreferences } from '../contexts/useUiPreferences'

interface ProjectLibraryProps {
  projects: ProjectSummary[]
  activeProjectId: string | null
  onOpenProject: (id: string) => void
  onNewProject: () => void
  onRenameProject: (id: string, title: string) => void
  onDuplicateProject: (id: string) => void
  onDeleteProject: (id: string) => void
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString()
}

function ProjectLibrary({
  projects,
  activeProjectId,
  onOpenProject,
  onNewProject,
  onRenameProject,
  onDuplicateProject,
  onDeleteProject
}: ProjectLibraryProps) {
  const { t } = useUiPreferences()

  return (
    <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--card-border)] px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-strong)]">{t('projects.title')}</h3>
          <p className="text-xs text-[var(--text-muted)]">{t('projects.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={onNewProject}
          className="rounded-xl bg-gradient-to-r from-primary-500 to-accent-500 px-3 py-2 text-xs font-semibold text-white shadow-warm"
        >
          {t('projects.new')}
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="px-4 py-5 text-sm text-[var(--text-muted)]">{t('projects.empty')}</div>
      ) : (
        <div className="max-h-72 overflow-y-auto p-2">
          {projects.map((project) => (
            <article
              key={project.id}
              className={`rounded-xl border p-3 transition ${
                project.id === activeProjectId
                  ? 'border-primary-300 bg-primary-50/70'
                  : 'border-[var(--border-soft)] bg-[var(--surface)] hover:border-primary-200'
              }`}
            >
              <button
                type="button"
                className="w-full text-left"
                onClick={() => onOpenProject(project.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold text-[var(--text-strong)]">{project.title}</h4>
                    <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{project.fileName || t('projects.noFile')}</p>
                  </div>
                  <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--text-muted)]">
                    {t('projects.slideCount', { count: project.slideCount })}
                  </span>
                </div>
                <p className="mt-2 text-xs text-[var(--text-faint)]">
                  {t('projects.updatedAt', { date: formatDate(project.updatedAt) })}
                </p>
              </button>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border-soft)] px-2.5 py-1 text-xs text-[var(--text-muted)] hover:border-primary-300 hover:text-primary-700"
                  onClick={() => {
                    const title = window.prompt(t('projects.renamePrompt'), project.title)
                    if (title?.trim()) onRenameProject(project.id, title.trim())
                  }}
                >
                  {t('projects.rename')}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border-soft)] px-2.5 py-1 text-xs text-[var(--text-muted)] hover:border-primary-300 hover:text-primary-700"
                  onClick={() => onDuplicateProject(project.id)}
                >
                  {t('projects.duplicate')}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                  onClick={() => {
                    if (window.confirm(t('projects.deleteConfirm'))) onDeleteProject(project.id)
                  }}
                >
                  {t('projects.delete')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export default ProjectLibrary
```

- [ ] **Step 5: Add translations**

In `web/src/i18n.ts`, add Chinese keys:

```ts
'projects.title': '项目',
'projects.subtitle': '管理多个 PPT 会话',
'projects.new': '新建项目',
'projects.empty': '还没有保存的项目',
'projects.noFile': '未上传资料',
'projects.slideCount': '{count} 页',
'projects.updatedAt': '更新于 {date}',
'projects.rename': '重命名',
'projects.renamePrompt': '项目名称',
'projects.duplicate': '复制',
'projects.delete': '删除',
'projects.deleteConfirm': '确定删除这个项目吗？此操作会移除本地保存的图片和内容。',
```

Add English keys:

```ts
'projects.title': 'Projects',
'projects.subtitle': 'Manage multiple PPT sessions',
'projects.new': 'New project',
'projects.empty': 'No saved projects yet',
'projects.noFile': 'No source uploaded',
'projects.slideCount': '{count} slides',
'projects.updatedAt': 'Updated {date}',
'projects.rename': 'Rename',
'projects.renamePrompt': 'Project name',
'projects.duplicate': 'Duplicate',
'projects.delete': 'Delete',
'projects.deleteConfirm': 'Delete this project? This removes locally saved images and content.',
```

- [ ] **Step 6: Wire ProjectLibrary into App**

In `web/src/App.tsx`, import:

```ts
import ProjectLibrary from './components/ProjectLibrary'
import { useProjectManager } from './hooks/useProjectManager'
```

Inside `AppContent`, add:

```ts
  const projectManager = useProjectManager()
```

Add handlers:

```ts
  const handleOpenProject = useCallback(async (id: string) => {
    const project = await projectManager.openProject(id)
    if (!project) return
    restoreState({
      projectId: project.id,
      fileContent: project.fileContent,
      fileName: project.fileName,
      slides: project.slides,
      generationConfig: project.generationConfig,
      workflow: project.workflow,
      status: project.status,
      lastCompletedSlides: project.lastCompletedSlides
    })
    setConfirmedSlidePrompts(project.workflow.slidePrompts.length ? project.workflow.slidePrompts : null)
  }, [projectManager, restoreState])

  const handleCreateProject = useCallback(async () => {
    const project = await projectManager.createProject({
      generationConfig: state.generationConfig,
      workflow: state.workflow
    })
    restoreState({
      projectId: project.id,
      fileContent: project.fileContent,
      fileName: project.fileName,
      slides: project.slides,
      generationConfig: project.generationConfig,
      workflow: project.workflow,
      status: project.status,
      lastCompletedSlides: project.lastCompletedSlides
    })
    setConfirmedSlidePrompts(null)
  }, [projectManager, restoreState, state.generationConfig, state.workflow])
```

Place `ProjectLibrary` above `NewProjectButton` in the center panel or in the left panel below upload:

```tsx
<ProjectLibrary
  projects={projectManager.projects}
  activeProjectId={projectManager.activeProjectId}
  onOpenProject={handleOpenProject}
  onNewProject={handleCreateProject}
  onRenameProject={projectManager.renameProject}
  onDuplicateProject={projectManager.duplicateProject}
  onDeleteProject={projectManager.deleteProject}
/>
```

- [ ] **Step 7: Run tests**

Run:

```bash
cd web
npm run test -- ProjectLibrary --run
npm run test -- ProjectStore --run
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/hooks/useProjectManager.ts web/src/components/ProjectLibrary.tsx web/src/components/__tests__/ProjectLibrary.test.tsx web/src/App.tsx web/src/i18n.ts
git commit -m "feat: add multi-project library"
```

---

### Task 8: Persist Confirmed Edits And Edit History

**Files:**
- Modify: `web/src/hooks/useEdit.ts`
- Modify: `web/src/types/index.ts`
- Modify: `web/src/components/__tests__/EditHistory.property.test.tsx`
- Modify: `web/src/components/__tests__/StatePersistence.property.test.tsx`

- [ ] **Step 1: Add failing persistence assertion**

Append this test to `web/src/components/__tests__/StatePersistence.property.test.tsx`:

```tsx
  it('persists slide edit history after a confirmed edit', async () => {
    const editedSlide: Slide = {
      id: 'slide-1',
      pageNumber: 1,
      imageUrl: 'data:image/png;base64,new',
      imageBase64: 'new',
      prompt: 'prompt',
      editHistory: [{
        imageUrl: 'data:image/png;base64,old',
        imageBase64: 'old',
        instruction: 'make it blue',
        timestamp: 1712131200000
      }]
    }

    const project = buildProjectRecord({
      id: 'project-history',
      slides: [editedSlide],
      lastCompletedSlides: [editedSlide]
    })
    await saveProjectRecord(project)
    const restored = await hydrateProjectImages((await getProject('project-history'))!)
    expect(restored.slides[0].editHistory).toHaveLength(1)
    expect(restored.slides[0].editHistory?.[0].instruction).toBe('make it blue')
  })
```

Add missing imports at the top:

```ts
import { getProject, hydrateProjectImages, saveProjectRecord } from '../../services/projectStore'
import { buildProjectRecord } from '../../services/projectStore.test-utils'
```

- [ ] **Step 2: Run test**

Run:

```bash
cd web
npm run test -- StatePersistence --run
```

Expected: PASS may already happen because `editHistory` is plain JSON. If it passes, keep the test as coverage. If it fails due imports or type mismatch, fix imports/types exactly as shown.

- [ ] **Step 3: Store confirmed edit history on slide**

In `web/src/hooks/useEdit.ts`, update `confirmEdit` to include history:

```ts
    const existingSlide = state.slides.find(slide => slide.id === slideId)
    const mergedHistory = [
      ...(existingSlide?.editHistory || []),
      ...state.editingSlide.history
    ]

    updateSlide(slideId, {
      imageBase64: currentBase64,
      imageUrl: `data:image/png;base64,${currentBase64}`,
      editHistory: mergedHistory,
      updatedAt: Date.now()
    })
```

The complete `confirmEdit` body should still select the slide and call `endEdit()` after `updateSlide`.

- [ ] **Step 4: Initialize edit session from persisted history**

In `beginEdit`, replace `history: []` with:

```ts
history: slide.editHistory || [],
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd web
npm run test -- EditHistory StatePersistence --run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/useEdit.ts web/src/types/index.ts web/src/components/__tests__/EditHistory.property.test.tsx web/src/components/__tests__/StatePersistence.property.test.tsx
git commit -m "feat: persist slide edit history"
```

---

### Task 9: Add Missing Asset Recovery UI

**Files:**
- Modify: `web/src/hooks/useStateRestore.ts`
- Modify: `web/src/components/RestoreSessionDialog.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/i18n.ts`
- Modify: `web/src/services/projectStore.ts`

- [ ] **Step 1: Add restore integrity fields**

Modify `web/src/hooks/useStateRestore.ts` `RestoredProject`:

```ts
export interface RestoredProject {
  projectId: string
  fileContent: string
  fileName: string
  slides: Slide[]
  generationConfig: GenerationConfig
  workflow: WorkflowState
  missingAssetKeys: string[]
}
```

Import `verifyProjectIntegrity`:

```ts
import { verifyProjectIntegrity } from '../services/projectStore'
```

In `checkSavedState`, after loading project:

```ts
const integrity = await verifyProjectIntegrity(project)
```

Include:

```ts
missingAssetKeys: integrity.missingAssetKeys
```

- [ ] **Step 2: Add dialog warning**

In `web/src/components/RestoreSessionDialog.tsx`, after project info block, add:

```tsx
        {restoredProject.missingAssetKeys.length > 0 && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {t('restore.missingImages', { count: restoredProject.missingAssetKeys.length })}
          </div>
        )}
```

- [ ] **Step 3: Add translations**

In Chinese section of `web/src/i18n.ts`:

```ts
'restore.missingImages': '检测到 {count} 张图片没有完整恢复。你仍然可以恢复文字和大纲，并重新生成缺失页面。',
```

In English section:

```ts
'restore.missingImages': '{count} images could not be fully restored. You can still restore text and outline, then regenerate missing pages.',
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd web
npm run test -- StatePersistence --run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useStateRestore.ts web/src/components/RestoreSessionDialog.tsx web/src/App.tsx web/src/i18n.ts web/src/services/projectStore.ts
git commit -m "feat: warn about missing restored images"
```

---

### Task 10: Stabilize Generate-Next-Deck Flow

**Files:**
- Modify: `web/src/hooks/useGeneration.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/GenerateButton.tsx`
- Modify: `web/src/components/__tests__/SlideGeneration.property.test.tsx`

- [ ] **Step 1: Add test for preserving previous deck while generating**

Append this pure reducer test to `web/src/components/__tests__/SlideGeneration.property.test.tsx`:

```tsx
import { appReducerForTests, initialAppStateForTests } from '../../contexts/AppStateContext'
import { buildSlide } from '../../services/projectStore.test-utils'

it('preserves last completed deck while new generation is in progress', () => {
  const previousDeck = [buildSlide({ id: 'slide-old', imageBase64: 'old', imageUrl: 'data:image/png;base64,old' })]
  const generating = appReducerForTests({
    ...initialAppStateForTests,
    fileContent: '# L9',
    fileName: 'L9.md',
    slides: previousDeck,
    lastCompletedSlides: previousDeck,
    status: 'generated'
  }, { type: 'START_GENERATION', payload: { runId: 'run-1' } })

  expect(generating.slides).toEqual([])
  expect(generating.lastCompletedSlides).toEqual(previousDeck)
})
```

- [ ] **Step 2: Run test**

Run:

```bash
cd web
npm run test -- SlideGeneration --run
```

Expected: PASS if Task 4 was completed; otherwise fail and finish Task 4 first.

- [ ] **Step 3: Improve generate handler**

In `web/src/hooks/useGeneration.ts`, update fatal error handler so previous completed deck can be restored in UI:

```ts
    const handleError = (data: SSEErrorData) => {
      if (data.fatal) {
        setGenerationError(data.message)
        abortControllerRef.current = null
      } else {
        updateProgress(
          state.generationProgress.current,
          state.generationProgress.total,
          'error',
          data.message
        )
      }
    }
```

No code change may be needed if this body already matches; the important invariant is reducer `GENERATION_ERROR` must not clear `lastCompletedSlides`.

- [ ] **Step 4: Show previous completed deck during generation if current slides are empty**

In `web/src/App.tsx`, define:

```ts
const visibleSlides = slides.length > 0 ? slides : state.lastCompletedSlides
```

Use `visibleSlides` for `RightPanel` and `useExport`:

```ts
const { state: exportState, startExport } = useExport(visibleSlides, state.generationConfig.aspectRatio)
```

```tsx
<RightPanel
  slides={visibleSlides}
  selectedSlideId={state.selectedSlideId}
  onSlideSelect={handleSlideSelect}
  onSlideEdit={handleSlideEdit}
  onExport={handleExport}
  isExporting={exportState.isExporting}
  exportProgress={exportState.progress}
  isLoading={isGenerating && slides.length === 0 && state.lastCompletedSlides.length === 0}
/>
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd web
npm run test -- SlideGeneration AutoSavePersistence --run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/useGeneration.ts web/src/App.tsx web/src/components/GenerateButton.tsx web/src/components/__tests__/SlideGeneration.property.test.tsx
git commit -m "fix: preserve decks during regeneration"
```

---

### Task 11: Documentation And User-Facing Copy

**Files:**
- Modify: `README.md`
- Modify: `README_en.md`
- Modify: `web/src/i18n.ts`

- [ ] **Step 1: Update Chinese README**

In `README.md`, add this bullet under features:

```md
- 💾 **多项目本地留存**：支持在浏览器本地保存多个 PPT 项目，恢复资料、设计大纲、逐页设计、生成图片和单页编辑历史
```

Add this section after startup instructions:

```md
### 本地项目保存

AIPPT 会把项目内容保存在当前浏览器 Profile 的 IndexedDB 中，并用 localStorage 保存当前打开的项目 ID 和界面偏好。保存内容包括上传资料、PPT 内容设置、设计大纲、逐页设计、生成图片、编辑后的版本和导出所需图片数据。

注意：
- 清理浏览器站点数据会删除本地项目。
- 换浏览器或换设备不会自动同步项目。
- API Key 仍按本地配置策略处理，不会写入项目分享文件。
```

- [ ] **Step 2: Update English README**

In `README_en.md`, add:

```md
- 💾 **Local multi-project persistence**: Save multiple PPT projects in the browser, including source content, outline, page designs, generated images, and per-slide edit history
```

Add:

```md
### Local Project Persistence

AIPPT stores projects in the current browser profile's IndexedDB, with localStorage used only for the active project id and UI preferences. Saved data includes uploaded sources, content settings, design outlines, page designs, generated images, edited versions, and image data needed for export.

Notes:
- Clearing browser site data removes local projects.
- Projects do not automatically sync across browsers or devices.
- API keys still follow the local configuration strategy and are not written into project export files.
```

- [ ] **Step 3: Ensure UI strings avoid technical JSON language**

Scan `web/src/i18n.ts` for:

```bash
rg -n "JSON|json|technical|debug|payload|schema" web/src/i18n.ts web/src/components
```

Expected: no user-facing labels should expose JSON/payload/schema language. If matches are test IDs or developer comments, leave them. If matches are visible strings, replace them with user-facing wording such as “设计大纲”, “逐页设计”, or “恢复详情”.

- [ ] **Step 4: Commit**

```bash
git add README.md README_en.md web/src/i18n.ts
git commit -m "docs: describe local multi-project persistence"
```

---

### Task 12: Full Verification And Browser Smoke

**Files:**
- No production files unless verification finds a bug.

- [ ] **Step 1: Run frontend checks**

Run:

```bash
cd web
npm run lint
npm run test -- --run
npm run build
```

Expected:
- `npm run lint`: exits 0
- `npm run test -- --run`: all tests pass
- `npm run build`: exits 0

- [ ] **Step 2: Run backend tests**

Run:

```bash
python -m pytest tests -q
```

Expected: all backend tests pass.

- [ ] **Step 3: Manual browser smoke**

Start services:

```bash
./start.sh
```

Open:

```text
http://localhost:5173
```

Perform this exact flow:

1. Create a new project.
2. Upload `doc/L9.md`.
3. Generate design outline.
4. Confirm outline to produce page designs.
5. Generate 6 slides.
6. Refresh the browser.
7. Restore the project.
8. Confirm source content, outline, page designs, slides, and images are still present.
9. Create a second project without refreshing.
10. Upload `doc/L9.md` again with different content requirements.
11. Generate at least 2 slides.
12. Open the project library and switch back to the first project.
13. Confirm the first project still has its original slides and images.
14. Edit one slide in the first project.
15. Confirm edit replacement.
16. Refresh the browser.
17. Restore and confirm edited slide and edit history remain.
18. Export PDF and PPTX.

Expected:
- No project requires a page refresh to start the next deck.
- Project switching does not mix source files and slides.
- A refresh during or after generation does not erase the last completed deck.
- Missing images, if any, are shown as a recovery warning rather than silent blank cards.

- [ ] **Step 4: Inspect browser storage manually**

In Chrome DevTools Application tab:

1. Open IndexedDB.
2. Confirm database `aippt_projects` exists.
3. Confirm object stores `projects` and `assets` exist.
4. Confirm at least two project records exist after the smoke flow.
5. Confirm image assets exist for generated slides.
6. Confirm localStorage only has small keys such as active project id, API config, layout, and UI preferences.

Expected: no large base64 slide images remain in localStorage.

- [ ] **Step 5: Commit any verification fixes**

If a bug is found and fixed during smoke testing:

```bash
git add <changed-files>
git commit -m "fix: stabilize project persistence smoke flow"
```

If no bug is found, do not create an empty commit.

---

## Self-Review

**Spec coverage:** This plan covers long-term local persistence, multi-session project management, partial data loss where outlines remain but images disappear, regenerating another PPT without refresh, preserving design workflow state, persisting edit history, and recovery warnings for missing assets.

**Placeholder scan:** The plan avoids TBD-style placeholders. Every task includes exact files, concrete test content, implementation snippets, commands, expected outcomes, and commit messages.

**Type consistency:** `ProjectRecord`, `WorkflowState`, `SlideAssetRef`, `ProjectSummary`, and `ProjectStatus` are introduced in Task 1 and reused consistently by later tasks. `projectId`, `workflow`, `status`, `generationRunId`, and `lastCompletedSlides` are added to app state before hooks and UI rely on them.

**Risk notes:** The IndexedDB transaction stores project metadata and assets together for the save operation, which removes the existing race where localStorage can point to images that have not been written yet. Browser storage can still be cleared by the user or browser policy; Task 9 makes missing assets explicit instead of silent. Server-side project persistence and cross-device sync remain outside this local-first change.
