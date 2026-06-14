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
  const currentProjectSummary: ProjectSummary = {
    id: 'current-project',
    title: 'Current Deck',
    fileName: 'current.md',
    slideCount: 1,
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
  const duplicateProjectRecord: ProjectRecord = {
    ...projectRecord,
    id: 'duplicate-project',
    title: 'Current Deck copy',
    fileName: 'current-copy.md',
    fileContent: '# Duplicate',
    slides: [{
      ...slide,
      id: 'duplicate-slide',
      pageNumber: 1,
      prompt: 'duplicate prompt'
    }],
    lastCompletedSlides: [],
    createdAt: 1712131300000,
    updatedAt: 1712131300000,
    lastOpenedAt: 1712131300000
  }

  return {
    operations,
    generationSlides: [slide] as Slide[],
    generationIsGenerating: true,
    rightPanelSnapshots: [] as Array<{ slideIds: string[]; isLoading: boolean; hasEditHandler: boolean }>,
    exportSlideSnapshots: [] as string[][],
    capturedAutoSaveParams: undefined as Record<string, unknown> | undefined,
    startExport: vi.fn(),
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
    duplicateProject: vi.fn(async () => {
      operations.push('duplicate')
      return duplicateProjectRecord
    }),
    deleteProject: vi.fn(async () => {
      operations.push('delete')
    }),
    slide,
    projectRecord,
    projectSummary,
    currentProjectSummary
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

vi.mock('../RightPanel', () => ({
  default: ({
    slides,
    isLoading,
    onSlideEdit
  }: {
    slides: Slide[]
    isLoading?: boolean
    onSlideEdit?: (slideId: string) => void
  }) => {
    mocks.rightPanelSnapshots.push({
      slideIds: slides.map(slide => slide.id),
      isLoading: Boolean(isLoading),
      hasEditHandler: typeof onSlideEdit === 'function'
    })

    return <div data-testid="right-panel-slide-ids">{slides.map(slide => slide.id).join(',')}</div>
  }
}))
vi.mock('../ApiConfigForm', () => ({ default: () => null }))
vi.mock('../GenerationConfigForm', () => ({ default: () => null }))
vi.mock('../DesignWorkflowPanel', () => ({
  default: ({ children, fileContent }: { children?: React.ReactNode; fileContent: string }) => (
    <div>
      <div data-testid="workflow-file-content">{fileContent}</div>
      {children}
    </div>
  )
}))
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
  useExport: (slides: Slide[]) => {
    mocks.exportSlideSnapshots.push(slides.map(slide => slide.id))

    return {
      state: { isExporting: false, progress: 0, error: null },
      startExport: mocks.startExport
    }
  }
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
    isGenerating: mocks.generationIsGenerating,
    progress: { current: 1, total: 3, status: 'generating', message: 'Generating' },
    error: null,
    slides: mocks.generationSlides
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
    projects: [mocks.currentProjectSummary, mocks.projectSummary],
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
    mocks.generationSlides = [mocks.slide]
    mocks.generationIsGenerating = true
    mocks.rightPanelSnapshots.length = 0
    mocks.exportSlideSnapshots.length = 0
    mocks.capturedAutoSaveParams = undefined
    mocks.projectRecord.fileName = 'saved.md'
    mocks.projectRecord.fileContent = '# Saved'
    mocks.projectRecord.slides = []
    mocks.projectRecord.lastCompletedSlides = []
    mocks.projectRecord.status = 'generated'
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

  it('flushes current autosave and cancels generation before deleting the current project', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '删除 Current Deck' }))

    await waitFor(() => {
      expect(mocks.deleteProject).toHaveBeenCalledWith('current-project')
    })
    expect(mocks.operations.indexOf('save')).toBeGreaterThanOrEqual(0)
    expect(mocks.operations.indexOf('cancel')).toBeGreaterThanOrEqual(0)
    expect(mocks.operations.indexOf('save')).toBeLessThan(mocks.operations.indexOf('delete'))
    expect(mocks.operations.indexOf('cancel')).toBeLessThan(mocks.operations.indexOf('delete'))
  })

  it('flushes current autosave, cancels generation, and restores the duplicate project', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '复制 Current Deck' }))

    await waitFor(() => {
      expect(mocks.duplicateProject).toHaveBeenCalledWith('current-project')
    })
    expect(mocks.operations.indexOf('save')).toBeGreaterThanOrEqual(0)
    expect(mocks.operations.indexOf('cancel')).toBeGreaterThanOrEqual(0)
    expect(mocks.operations.indexOf('save')).toBeLessThan(mocks.operations.indexOf('duplicate'))
    expect(mocks.operations.indexOf('cancel')).toBeLessThan(mocks.operations.indexOf('duplicate'))
    await waitFor(() => {
      expect(screen.getByTestId('workflow-file-content')).toHaveTextContent('# Duplicate')
    })
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

  it('renders and exports the last completed deck while regeneration has no current slides yet', async () => {
    const previousSlide: Slide = {
      ...mocks.slide,
      id: 'previous-completed-slide',
      imageUrl: 'data:image/png;base64,previous',
      imageBase64: 'previous',
      prompt: 'previous prompt'
    }
    mocks.generationSlides = []
    mocks.projectRecord.fileContent = '# Regenerating'
    mocks.projectRecord.slides = []
    mocks.projectRecord.lastCompletedSlides = [previousSlide]
    mocks.projectRecord.status = 'generating'

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /打开 Saved Deck/ }))

    await waitFor(() => {
      expect(screen.getByTestId('workflow-file-content')).toHaveTextContent('# Regenerating')
    })
    await waitFor(() => {
      expect(screen.getByTestId('right-panel-slide-ids')).toHaveTextContent('previous-completed-slide')
    })

    const latestRightPanel = mocks.rightPanelSnapshots[mocks.rightPanelSnapshots.length - 1]
    expect(latestRightPanel).toEqual({
      slideIds: ['previous-completed-slide'],
      isLoading: false,
      hasEditHandler: false
    })
    expect(mocks.exportSlideSnapshots).toContainEqual(['previous-completed-slide'])
  })

  it('does not create a new project when the current autosave flush fails', async () => {
    const error = new Error('save failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.saveNow.mockRejectedValueOnce(error)

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '新建项目' }))

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Failed to save current project before switching:', error)
    })
    expect(mocks.createProject).not.toHaveBeenCalled()
    expect(mocks.cancelGeneration).not.toHaveBeenCalled()
  })

  it('does not delete the current project when the current autosave flush fails', async () => {
    const error = new Error('save failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocks.saveNow.mockRejectedValueOnce(error)

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '删除 Current Deck' }))

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Failed to save current project before switching:', error)
    })
    expect(mocks.deleteProject).not.toHaveBeenCalled()
    expect(mocks.cancelGeneration).not.toHaveBeenCalled()
  })

  it('refreshes project summaries after autosave reports a durable save', () => {
    render(<App />)

    expect(typeof mocks.capturedAutoSaveParams?.onSaved).toBe('function')
    ;(mocks.capturedAutoSaveParams?.onSaved as (projectId: string) => void)('current-project')

    expect(mocks.refreshProjects).toHaveBeenCalled()
  })

  it('renames a project exactly once from the project library action', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Renamed Deck')

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '重命名 Saved Deck' }))

    await waitFor(() => {
      expect(mocks.renameProject).toHaveBeenCalledWith('saved-project', 'Renamed Deck')
    })
    expect(mocks.renameProject).toHaveBeenCalledTimes(1)
  })
})
