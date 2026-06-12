import { describe, expect, it } from 'vitest'
import {
  AppState,
  appReducerForTests,
  initialAppStateForTests
} from '../../contexts/AppStateContext'
import { Slide, WorkflowState } from '../../types'
import {
  buildDeckOutline,
  buildSlide,
  buildSlidePrompt,
  EMPTY_WORKFLOW_STATE,
  TEST_GENERATION_CONFIG
} from '../../services/projectStore.test-utils'

function cloneWorkflow(workflow: WorkflowState): WorkflowState {
  return {
    ...workflow,
    outline: workflow.outline ? { ...workflow.outline, slides: workflow.outline.slides.map(slide => ({ ...slide })) } : null,
    slidePrompts: workflow.slidePrompts.map(prompt => ({ ...prompt })),
    expandedOutlinePages: [...workflow.expandedOutlinePages],
    expandedDesignPages: [...workflow.expandedDesignPages]
  }
}

function slide(overrides: Partial<Slide> = {}): Slide {
  return buildSlide(overrides)
}

function workflow(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    ...cloneWorkflow(EMPTY_WORKFLOW_STATE),
    ...overrides
  }
}

function staleState(overrides: Partial<AppState> = {}): AppState {
  const existingSlide = slide({ id: 'slide-old', pageNumber: 1 })
  return {
    ...initialAppStateForTests,
    projectId: 'project-old',
    fileContent: '# old',
    fileName: 'old.md',
    slides: [existingSlide],
    lastCompletedSlides: [existingSlide],
    selectedSlideId: existingSlide.id,
    editingSlide: {
      slideId: existingSlide.id,
      originalImage: existingSlide.imageUrl,
      currentImage: existingSlide.imageUrl,
      history: [],
      userInput: 'make it brighter'
    },
    workflow: workflow({
      status: 'prompts_ready',
      outline: buildDeckOutline(),
      slidePrompts: [buildSlidePrompt()]
    }),
    status: 'prompts_ready',
    generationRunId: 'run-old',
    ...overrides
  }
}

describe('AppState persistence reducer behavior', () => {
  it('clears stale slides and workflow when file content changes to a different file', () => {
    const result = appReducerForTests(
      staleState(),
      { type: 'SET_FILE_CONTENT', payload: { content: '# new', name: 'new.md' } }
    )

    expect(result.uploadedFile).toBeNull()
    expect(result.fileContent).toBe('# new')
    expect(result.fileName).toBe('new.md')
    expect(result.projectId).toBeNull()
    expect(result.slides).toEqual([])
    expect(result.lastCompletedSlides).toEqual([])
    expect(result.selectedSlideId).toBeNull()
    expect(result.editingSlide).toBeNull()
    expect(result.workflow).toEqual(EMPTY_WORKFLOW_STATE)
    expect(result.status).toBe('draft')
    expect(result.generationRunId).toBeNull()
  })

  it('clears stale slides and workflow when a different file object is selected', () => {
    const file = new File(['# new'], 'new.md', { type: 'text/markdown' })

    const result = appReducerForTests(
      staleState(),
      { type: 'SET_FILE', payload: { file, content: '# new', name: 'new.md' } }
    )

    expect(result.uploadedFile).toBe(file)
    expect(result.fileContent).toBe('# new')
    expect(result.fileName).toBe('new.md')
    expect(result.projectId).toBeNull()
    expect(result.slides).toEqual([])
    expect(result.lastCompletedSlides).toEqual([])
    expect(result.selectedSlideId).toBeNull()
    expect(result.editingSlide).toBeNull()
    expect(result.workflow).toEqual(EMPTY_WORKFLOW_STATE)
    expect(result.status).toBe('draft')
    expect(result.generationRunId).toBeNull()
  })

  it('keeps completed slides but clears current slides when generation starts', () => {
    const completedSlides = [slide({ id: 'slide-completed', pageNumber: 1 })]
    const currentSlides = [slide({ id: 'slide-current', pageNumber: 2 })]

    const result = appReducerForTests(
      staleState({
        slides: currentSlides,
        lastCompletedSlides: completedSlides,
        status: 'generated'
      }),
      { type: 'START_GENERATION', payload: { runId: 'run-1' } }
    )

    expect(result.isGenerating).toBe(true)
    expect(result.status).toBe('generating')
    expect(result.generationRunId).toBe('run-1')
    expect(result.lastCompletedSlides).toEqual(completedSlides)
    expect(result.slides).toEqual([])
  })

  it('snapshots generated slides when generation completes', () => {
    const generatedSlides = [
      slide({ id: 'slide-1', pageNumber: 1 }),
      slide({ id: 'slide-2', pageNumber: 2 })
    ]

    const result = appReducerForTests(
      staleState({
        slides: generatedSlides,
        lastCompletedSlides: [],
        status: 'generating',
        generationRunId: 'run-1',
        isGenerating: true
      }),
      { type: 'COMPLETE_GENERATION' }
    )

    expect(result.isGenerating).toBe(false)
    expect(result.status).toBe('generated')
    expect(result.generationRunId).toBeNull()
    expect(result.lastCompletedSlides).toEqual(generatedSlides)
  })

  it('restores project-aware state with sorted unique slides and completed-slide fallback', () => {
    const duplicateFirst = slide({ id: 'slide-a', pageNumber: 3, prompt: 'older' })
    const duplicateLast = slide({ id: 'slide-a', pageNumber: 1, prompt: 'newer' })
    const middle = slide({ id: 'slide-b', pageNumber: 2 })
    const restoredWorkflow = workflow({
      status: 'prompts_ready',
      outline: buildDeckOutline(),
      slidePrompts: [buildSlidePrompt()]
    })

    const result = appReducerForTests(
      initialAppStateForTests,
      {
        type: 'RESTORE_STATE',
        payload: {
          projectId: 'project-1',
          fileContent: '# restored',
          fileName: 'restored.md',
          slides: [duplicateFirst, middle, duplicateLast],
          generationConfig: TEST_GENERATION_CONFIG,
          workflow: restoredWorkflow,
          status: 'prompts_ready'
        }
      }
    )

    expect(result.projectId).toBe('project-1')
    expect(result.fileContent).toBe('# restored')
    expect(result.fileName).toBe('restored.md')
    expect(result.workflow).toEqual(restoredWorkflow)
    expect(result.status).toBe('prompts_ready')
    expect(result.slides).toEqual([duplicateLast, middle])
    expect(result.lastCompletedSlides).toEqual([duplicateLast, middle])
    expect(result.generationRunId).toBeNull()
    expect(result.generationProgress).toMatchObject({
      current: 2,
      total: 2,
      status: 'completed'
    })
  })

  it('restores distinct current slides and last completed slide snapshot', () => {
    const currentSlides = [
      slide({ id: 'current-slide', pageNumber: 1, prompt: 'Current in-progress slide' })
    ]
    const completedSlides = [
      slide({ id: 'completed-slide', pageNumber: 1, prompt: 'Last completed slide' })
    ]

    const result = appReducerForTests(
      initialAppStateForTests,
      {
        type: 'RESTORE_STATE',
        payload: {
          projectId: 'project-distinct',
          fileContent: '# restored',
          fileName: 'restored.md',
          slides: currentSlides,
          generationConfig: TEST_GENERATION_CONFIG,
          workflow: workflow(),
          status: 'error',
          lastCompletedSlides: completedSlides
        }
      }
    )

    expect(result.status).toBe('error')
    expect(result.slides).toEqual(currentSlides)
    expect(result.lastCompletedSlides).toEqual(completedSlides)
  })

  it('normalizes transient generating status when restoring a persisted project', () => {
    const generatedSlides = [
      slide({ id: 'generated-slide', pageNumber: 1, prompt: 'Generated slide' })
    ]
    const restoredWorkflow = workflow({
      status: 'prompts_ready',
      outline: buildDeckOutline(),
      slidePrompts: [buildSlidePrompt()]
    })

    const result = appReducerForTests(
      staleState({
        isGenerating: true,
        generationRunId: 'stale-run',
        generationProgress: {
          current: 0,
          total: 1,
          status: 'generating',
          message: 'stale generation'
        }
      }),
      {
        type: 'RESTORE_STATE',
        payload: {
          projectId: 'project-generating',
          fileContent: '# restored',
          fileName: 'restored.md',
          slides: generatedSlides,
          generationConfig: TEST_GENERATION_CONFIG,
          workflow: restoredWorkflow,
          status: 'generating',
          lastCompletedSlides: generatedSlides
        }
      }
    )

    expect(result.status).toBe('generated')
    expect(result.isGenerating).toBe(false)
    expect(result.generationRunId).toBeNull()
    expect(result.generationProgress).toMatchObject({
      current: 1,
      total: 1,
      status: 'completed'
    })
  })

  it('clears project state on reset while preserving API configs', () => {
    const state = staleState({
      apiConfig: { apiKey: 'image-key', baseUrl: 'https://image.example.test' },
      fullApiConfig: {
        image: {
          apiKey: 'image-key',
          baseUrl: 'https://image.example.test',
          model: 'image-model'
        },
        text: {
          apiKey: 'text-key',
          baseUrl: 'https://text.example.test',
          model: 'text-model',
          format: 'openai'
        }
      }
    })

    const result = appReducerForTests(state, { type: 'RESET_STATE' })

    expect(result.apiConfig).toEqual(state.apiConfig)
    expect(result.fullApiConfig).toEqual(state.fullApiConfig)
    expect(result.projectId).toBeNull()
    expect(result.slides).toEqual([])
    expect(result.workflow).toEqual(EMPTY_WORKFLOW_STATE)
    expect(result.generationRunId).toBeNull()
    expect(result.lastCompletedSlides).toEqual([])
  })
})
