import {
  ConfirmedSlidePrompt,
  DeckOutline,
  GenerationConfig,
  ProjectRecord,
  Slide,
  WorkflowState
} from '../types'

export const TEST_GENERATION_CONFIG: GenerationConfig = {
  pageCount: 10,
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
    title: 'Untitled deck',
    user_requirements: '',
    design_style: 'Modern',
    audience: 'Professional audience',
    slides: [],
    ...overrides
  }
}

export function buildSlidePrompt(overrides: Partial<ConfirmedSlidePrompt> = {}): ConfirmedSlidePrompt {
  return {
    page: 1,
    title: 'Slide 1',
    content_summary: 'Slide summary',
    display_content: 'Slide summary',
    prompt: 'Generate slide 1',
    ...overrides
  }
}

export function buildSlide(overrides: Partial<Slide> = {}): Slide {
  return {
    id: 'slide-1',
    pageNumber: 1,
    imageUrl: 'data:image/png;base64,aaa',
    imageBase64: 'aaa',
    prompt: 'Generate slide 1',
    ...overrides
  }
}

export function buildProjectRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  const now = Date.now()
  const slides = overrides.slides ?? []

  return {
    version: 2,
    id: 'project-1',
    title: 'Untitled deck',
    fileName: 'deck.md',
    fileContent: '',
    slides,
    generationConfig: TEST_GENERATION_CONFIG,
    workflow: EMPTY_WORKFLOW_STATE,
    status: 'draft',
    generationRunId: null,
    lastCompletedSlides: [],
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    ...overrides
  }
}

export async function resetProjectStoreForTests(): Promise<void> {
  localStorage.clear()

  if (typeof indexedDB === 'undefined') {
    return
  }

  await Promise.all([
    deleteIndexedDb('aippt_slide_images'),
    deleteIndexedDb('aippt_projects')
  ])
}

function deleteIndexedDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error || new Error(`Failed to delete ${name}`))
    request.onblocked = () => resolve()
  })
}
