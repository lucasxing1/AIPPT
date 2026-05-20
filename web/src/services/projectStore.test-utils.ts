import {
  ConfirmedSlidePrompt,
  DeckOutline,
  GenerationConfig,
  ProjectRecord,
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
  const slides = overrides.slides ?? [buildSlide()]

  return {
    version: 2,
    id: 'project-1',
    title: 'Demo deck',
    fileName: 'L9.md',
    fileContent: '# L9',
    slides,
    generationConfig: TEST_GENERATION_CONFIG,
    workflow: EMPTY_WORKFLOW_STATE,
    status: 'generated',
    generationRunId: null,
    lastCompletedSlides: slides,
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
