import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import type { ProjectRecord, ProjectSummary, Slide } from '../../types'

const mocks = vi.hoisted(() => {
  const operations: string[] = []
  const slide: Slide = {
    id: 'current-slide',
    pageNumber: 1,
    imageUrl: 'data:image/png;base64,current',
    imageBase64: 'current',
    prompt: 'current prompt'
  }
  const projectSummary: ProjectSummary = {
    id: 'saved-project',
    title: 'Saved Deck',
    fileName: 'saved.md',
    slideCount: 3,
    status: 'generated',
    createdAt: 1712131200000,
    updatedAt: 1712131200000,
    lastOpenedAt: 1712131200000
  }
  const projectRecord: ProjectRecord = {
    version: 2,
    id: 'saved-project',
    title: 'Saved Deck',
    fileName: 'saved.md',
    fileContent: '# Saved',
    slides: [],
    generationConfig: {
      pageCount: 3,
      quality: '1K',
      aspectRatio: '16:9'
    },
    workflow: {
      status: 'idle',
      outline: null,
      slidePrompts: [],
      expandedOutlinePages: [],
      expandedDesignPages: [],
      error: null
    },
    status: 'generated',
    generationRunId: null,
    lastCompletedSlides: [],
    createdAt: 1712131200000,
    updatedAt: 1712131200000,
    lastOpenedAt: 1712131200000
  }

  return {
    operations,
    capturedAutoSaveParams: undefined as Record<string, unknown> | undefined,
    saveNow: vi.fn(async () => {
      operations.push('save')
    }),
    cancelGeneration: vi.fn(() => {
      operations.push('cancel')
    }),
    openProject: vi.fn(async () => {
      operations.push('open')
      return projectRecord
    }),
    createProject: vi.fn(async () => {
      operations.push('create')
      return { ...projectRecord, id: 'new-project', title: 'Untitled project', fileName: '', fileContent: '' }
    }),
    refreshProjects: vi.fn(),
    renameProject: vi.fn(),
    duplicateProject: vi.fn(),
    deleteProject: vi.fn(),
    slide,
    projectSummary
  }
})

vi.mock('../Layout', () => ({
  default: ({ leftPanel, centerPanel, rightPanel }: { leftPanel: React.ReactNode; centerPanel: React.ReactNode; rightPanel: React.ReactNode }) => (
    <div>
      <section>{leftPanel}</section>
      <section>{centerPanel}</section>
      <section>{rightPanel}</section>
    </div>
  )
}))

vi.mock('../LeftPanel', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('../CenterPanel', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('../RightPanel', () => ({ default: () => null }))
vi.mock('../ApiConfigForm', () => ({ default: () => null }))
vi.mock('../GenerationConfigForm', () => ({ default: () => null }))
vi.mock('../DesignWorkflowPanel', () => ({ default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../GenerateButton', () => ({ default: () => null }))
vi.mock('../ProgressIndicator', () => ({ default: () => null }))
vi.mock('../ConfirmDialog', () => ({ default: () => null }))
vi.mock('../RestoreSessionDialog', () => ({ default: () => null }))

vi.mock('../../hooks/useEdit', () => ({
  useEdit: () => ({
    editSession: null,
    isEditing: false,
    beginEdit: vi.fn(),
    submitEdit: vi.fn(),
    revertToVersion: vi.fn(),
    confirmEdit: vi.fn(),
    cancelEdit: vi.fn()
  })
}))

vi.mock('../../hooks/useEditConflict', () => ({
  useEditConflict: () => ({
    showConfirmDialog: false,
    tryStartEdit: vi.fn(() => true),
    tryCancelEdit: vi.fn(() => true),
    confirmDiscard: vi.fn(),
    cancelDiscard: vi.fn()
  })
}))

vi.mock('../../hooks/useExport', () => ({
  useExport: () => ({
    state: { isExporting: false, progress: 0, error: null },
    startExport: vi.fn()
  })
}))

vi.mock('../../hooks/useStateRestore', () => ({
  useStateRestore: () => ({
    isRestoring: false,
    hasRestoredData: false,
    restoredProject: null,
    dismissRestore: vi.fn()
  })
}))

vi.mock('../../hooks/useGeneration', () => ({
  useGeneration: () => ({
    generate: vi.fn(),
    cancel: mocks.cancelGeneration,
    isGenerating: true,
    progress: { current: 1, total: 3, status: 'generating', message: 'Generating' },
    error: null,
    slides: [mocks.slide]
  })
}))

vi.mock('../../hooks/useAutoSave', () => ({
  useAutoSave: (params: Record<string, unknown>) => {
    mocks.capturedAutoSaveParams = params
    return {
      isSaving: false,
      lastSaved: null,
      saveNow: mocks.saveNow
    }
  }
}))

vi.mock('../../hooks/useProjectManager', () => ({
  useProjectManager: () => ({
    projects: [mocks.projectSummary],
    activeProjectId: 'current-project',
    isLoadingProjects: false,
    refreshProjects: mocks.refreshProjects,
    openProject: mocks.openProject,
    createProject: mocks.createProject,
    renameProject: mocks.renameProject,
    duplicateProject: mocks.duplicateProject,
    deleteProject: mocks.deleteProject
  })
}))

describe('App project lifecycle safeguards', () => {
  afterEach(() => {
    mocks.operations.length = 0
    mocks.capturedAutoSaveParams = undefined
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('flushes current autosave and cancels generation before opening another project', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /打开 Saved Deck/ }))

    await waitFor(() => {
      expect(mocks.openProject).toHaveBeenCalledWith('saved-project')
    })
    expect(mocks.operations.indexOf('save')).toBeGreaterThanOrEqual(0)
    expect(mocks.operations.indexOf('cancel')).toBeGreaterThanOrEqual(0)
    expect(mocks.operations.indexOf('save')).toBeLessThan(mocks.operations.indexOf('open'))
    expect(mocks.operations.indexOf('cancel')).toBeLessThan(mocks.operations.indexOf('open'))
  })

  it('flushes current autosave and cancels generation before creating a new project', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '新建项目' }))

    await waitFor(() => {
      expect(mocks.createProject).toHaveBeenCalled()
    })
    expect(mocks.operations.indexOf('save')).toBeGreaterThanOrEqual(0)
    expect(mocks.operations.indexOf('cancel')).toBeGreaterThanOrEqual(0)
    expect(mocks.operations.indexOf('save')).toBeLessThan(mocks.operations.indexOf('create'))
    expect(mocks.operations.indexOf('cancel')).toBeLessThan(mocks.operations.indexOf('create'))
  })

  it('does not switch projects when the current autosave flush fails', async () => {
    const error = new Error('save failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.saveNow.mockRejectedValueOnce(error)

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /打开 Saved Deck/ }))

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Failed to save current project before switching:', error)
    })
    expect(mocks.openProject).not.toHaveBeenCalled()
    expect(mocks.cancelGeneration).not.toHaveBeenCalled()
  })

  it('refreshes project summaries after autosave reports a durable save', () => {
    render(<App />)

    expect(typeof mocks.capturedAutoSaveParams?.onSaved).toBe('function')
    ;(mocks.capturedAutoSaveParams?.onSaved as (projectId: string) => void)('current-project')

    expect(mocks.refreshProjects).toHaveBeenCalled()
  })
})
