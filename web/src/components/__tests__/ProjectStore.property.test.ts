import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fc from 'fast-check'
import 'fake-indexeddb/auto'
import type { ProjectRecord, ProjectStatus, ProjectSummary, Slide } from '../../types'
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
  deleteStoredAsset,
  listStoredAssets,
  readStoredAsset,
  readStoredProject,
  resetProjectStoreForTests
} from '../../services/projectStore.test-utils'

const CURRENT_IMAGE = 'Y3VycmVudA=='
const COMPLETED_IMAGE = 'Y29tcGxldGVk'
const SECOND_IMAGE = 'c2Vjb25k'
const OTHER_IMAGE = 'b3RoZXI='

const currentAssetKey = (projectId: string, slideId: string) => `${projectId}:slides:${slideId}:current`
const completedAssetKey = (projectId: string, slideId: string) =>
  `${projectId}:lastCompletedSlides:${slideId}:current`

function imageSlide(overrides: Partial<Slide> = {}): Slide {
  return buildSlide({
    id: 'slide-1',
    pageNumber: 1,
    imageUrl: `data:image/png;base64,${CURRENT_IMAGE}`,
    imageBase64: CURRENT_IMAGE,
    prompt: 'Generate a cover page',
    ...overrides
  })
}

describe('IndexedDB project store', () => {
  beforeEach(async () => {
    await resetProjectStoreForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('saves and restores a project with slide images after a browser-like reload', async () => {
    const project = buildProjectRecord({
      id: 'project-images',
      title: 'Image deck',
      slides: [
        imageSlide({ id: 'slide-1', imageBase64: CURRENT_IMAGE, imageUrl: `data:image/png;base64,${CURRENT_IMAGE}` }),
        imageSlide({
          id: 'slide-2',
          pageNumber: 2,
          imageBase64: undefined,
          imageUrl: `data:image/jpeg;base64,${SECOND_IMAGE}`
        })
      ],
      lastCompletedSlides: [
        imageSlide({
          id: 'slide-1',
          imageBase64: COMPLETED_IMAGE,
          imageUrl: `data:image/png;base64,${COMPLETED_IMAGE}`
        })
      ]
    })

    const saved = await saveProjectRecord(project)
    const compact = await getProject('project-images')

    expect(localStorage.length).toBe(0)
    expect(saved).toEqual(compact)
    expect(compact?.slides[0]).toMatchObject({
      imageUrl: '',
      imageStorageKey: currentAssetKey('project-images', 'slide-1'),
      imageAsset: {
        key: currentAssetKey('project-images', 'slide-1'),
        mimeType: 'image/png',
        byteLength: 7
      }
    })
    expect(compact?.slides[0].imageBase64).toBeUndefined()
    expect(compact?.slides[1]).toMatchObject({
      imageUrl: '',
      imageStorageKey: currentAssetKey('project-images', 'slide-2'),
      imageAsset: {
        key: currentAssetKey('project-images', 'slide-2'),
        mimeType: 'image/jpeg',
        byteLength: 6
      }
    })
    expect(compact?.lastCompletedSlides[0]).toMatchObject({
      imageUrl: '',
      imageStorageKey: completedAssetKey('project-images', 'slide-1')
    })

    expect(await readStoredAsset(currentAssetKey('project-images', 'slide-1'))).toMatchObject({
      key: currentAssetKey('project-images', 'slide-1'),
      projectId: 'project-images',
      bucket: 'slides',
      slideId: 'slide-1',
      mimeType: 'image/png',
      imageBase64: CURRENT_IMAGE
    })

    const reloadedCompact = await readStoredProject('project-images')
    expect(reloadedCompact?.slides[0].imageBase64).toBeUndefined()
    expect(reloadedCompact?.slides[0].imageUrl).toBe('')

    const hydrated = await hydrateProjectImages(reloadedCompact as ProjectRecord)
    expect(hydrated.slides[0].imageBase64).toBe(CURRENT_IMAGE)
    expect(hydrated.slides[0].imageUrl).toBe(`data:image/png;base64,${CURRENT_IMAGE}`)
    expect(hydrated.slides[1].imageBase64).toBe(SECOND_IMAGE)
    expect(hydrated.slides[1].imageUrl).toBe(`data:image/jpeg;base64,${SECOND_IMAGE}`)
    expect(hydrated.lastCompletedSlides[0].imageBase64).toBe(COMPLETED_IMAGE)
    expect(hydrated.lastCompletedSlides[0].imageUrl).toBe(`data:image/png;base64,${COMPLETED_IMAGE}`)
  })

  it('keeps multiple projects and opens the requested active project', async () => {
    await saveProjectRecord(buildProjectRecord({
      id: 'older-project',
      title: 'Older',
      lastOpenedAt: 10,
      slides: [imageSlide({ id: 'older-slide', imageBase64: CURRENT_IMAGE })],
      lastCompletedSlides: []
    }))
    await saveProjectRecord(buildProjectRecord({
      id: 'newer-project',
      title: 'Newer',
      lastOpenedAt: 30,
      slides: [imageSlide({ id: 'newer-slide', imageBase64: SECOND_IMAGE })],
      lastCompletedSlides: []
    }))

    await setActiveProjectId('older-project')

    const activeId = await getActiveProjectId()
    const activeProject = activeId ? await getProject(activeId) : null
    const summaries = await getProjectSummaries()

    expect(activeId).toBe('older-project')
    expect(activeProject?.title).toBe('Older')
    expect(summaries.map((summary: ProjectSummary) => summary.id)).toEqual(['newer-project', 'older-project'])
    expect(summaries[0]).toMatchObject({
      id: 'newer-project',
      title: 'Newer',
      slideCount: 1,
      lastOpenedAt: 30
    })
  })

  it('renames, duplicates, and deletes projects without affecting other projects', async () => {
    await saveProjectRecord(buildProjectRecord({
      id: 'source-project',
      title: 'Source',
      slides: [imageSlide({ id: 'source-slide', imageBase64: CURRENT_IMAGE })],
      lastCompletedSlides: []
    }))
    await saveProjectRecord(buildProjectRecord({
      id: 'other-project',
      title: 'Other',
      slides: [imageSlide({ id: 'other-slide', imageBase64: OTHER_IMAGE })],
      lastCompletedSlides: []
    }))

    const renamed = await renameProject('source-project', 'Renamed source')
    const duplicate = await duplicateProject('source-project')
    const hydratedDuplicate = await hydrateProjectImages(duplicate)

    expect(renamed.title).toBe('Renamed source')
    expect((await getProject('source-project'))?.title).toBe('Renamed source')
    expect(duplicate.id).not.toBe('source-project')
    expect(duplicate.title).toBe('Renamed source copy')
    expect(duplicate.slides[0].imageStorageKey).toBe(currentAssetKey(duplicate.id, 'source-slide'))
    expect(hydratedDuplicate.slides[0].imageBase64).toBe(CURRENT_IMAGE)

    await setActiveProjectId('source-project')
    await deleteProject('source-project')

    expect(await getProject('source-project')).toBeNull()
    expect(await getActiveProjectId()).toBeNull()
    expect(await listStoredAssets('source-project')).toEqual([])
    expect((await getProject('other-project'))?.title).toBe('Other')
    expect(await getProject(duplicate.id)).not.toBeNull()
  })

  it('reports missing image assets instead of silently claiming full recovery', async () => {
    const project = buildProjectRecord({
      id: 'missing-assets',
      slides: [
        imageSlide({ id: 'slide-1', imageBase64: CURRENT_IMAGE }),
        imageSlide({ id: 'slide-2', pageNumber: 2, imageBase64: SECOND_IMAGE })
      ],
      lastCompletedSlides: [
        imageSlide({ id: 'slide-1', imageBase64: COMPLETED_IMAGE }),
        imageSlide({ id: 'slide-2', pageNumber: 2, imageBase64: OTHER_IMAGE })
      ]
    })
    const saved = await saveProjectRecord(project)

    await deleteStoredAsset(currentAssetKey('missing-assets', 'slide-2'))
    await deleteStoredAsset(completedAssetKey('missing-assets', 'slide-1'))

    const integrity = await verifyProjectIntegrity({
      ...saved,
      lastCompletedSlides: [
        ...saved.lastCompletedSlides,
        {
          ...saved.lastCompletedSlides[0],
          imageStorageKey: completedAssetKey('missing-assets', 'slide-1')
        }
      ]
    })
    const hydrated = await hydrateProjectImages(saved)

    expect(integrity).toEqual({
      ok: false,
      missingAssetKeys: [
        currentAssetKey('missing-assets', 'slide-2'),
        completedAssetKey('missing-assets', 'slide-1')
      ]
    })
    expect(hydrated.slides[0].imageBase64).toBe(CURRENT_IMAGE)
    expect(hydrated.slides[1].imageBase64).toBeUndefined()
    expect(hydrated.lastCompletedSlides[0].imageBase64).toBeUndefined()
  })

  it('does not save a compact slide reference when asset saving or opening fails', async () => {
    const project = buildProjectRecord({
      id: 'failed-save',
      slides: [imageSlide({ id: 'slide-1', imageBase64: CURRENT_IMAGE })],
      lastCompletedSlides: []
    })
    const openSpy = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      const request = { error: new Error('open failed') } as IDBOpenDBRequest
      queueMicrotask(() => {
        request.onerror?.call(request, new Event('error'))
      })
      return request
    })

    await expect(saveProjectRecord(project)).rejects.toThrow('open failed')
    openSpy.mockRestore()

    expect(await getProject('failed-save')).toBeNull()
    expect(await readStoredAsset(currentAssetKey('failed-save', 'slide-1'))).toBeNull()
  })

  it('persists arbitrary small project metadata without mutating source fields', async () => {
    const statusArbitrary = fc.constantFrom<ProjectStatus>(
      'draft',
      'planning',
      'prompts_ready',
      'generating',
      'generated',
      'editing',
      'error'
    )
    const projectMetadataArbitrary = fc.record({
      id: fc.uuid(),
      title: fc.string({ maxLength: 80 }),
      fileName: fc.string({ maxLength: 80 }),
      fileContent: fc.string({ maxLength: 200 }),
      status: statusArbitrary,
      generationRunId: fc.option(fc.string({ maxLength: 40 }), { nil: null }),
      createdAt: fc.nat({ max: 2_000_000 }),
      updatedAt: fc.nat({ max: 2_000_000 }),
      lastOpenedAt: fc.nat({ max: 2_000_000 })
    })

    await fc.assert(
      fc.asyncProperty(projectMetadataArbitrary, async (metadata) => {
        await resetProjectStoreForTests()
        const project: ProjectRecord = {
          ...buildProjectRecord({
            slides: [
              buildSlide({
                id: 'metadata-slide',
                imageUrl: '',
                imageBase64: undefined,
                prompt: 'Metadata-only slide'
              })
            ],
            lastCompletedSlides: []
          }),
          ...metadata,
          slides: [
            buildSlide({
              id: 'metadata-slide',
              imageUrl: '',
              imageBase64: undefined,
              prompt: 'Metadata-only slide'
            })
          ],
          lastCompletedSlides: []
        }
        const sourceSnapshot = structuredClone(project)

        const saved = await saveProjectRecord(project)
        const loaded = await getProject(project.id)

        expect(project).toEqual(sourceSnapshot)
        expect(saved).toEqual(loaded)
        expect(loaded).toMatchObject({
          id: metadata.id,
          title: metadata.title,
          fileName: metadata.fileName,
          fileContent: metadata.fileContent,
          status: metadata.status,
          generationRunId: metadata.generationRunId,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
          lastOpenedAt: metadata.lastOpenedAt
        })
      }),
      { numRuns: 30 }
    )
  })

  it('clears the active project id without deleting saved projects', async () => {
    const project = await saveProjectRecord(buildProjectRecord({
      id: 'active-project',
      slides: [imageSlide({ id: 'slide-1', imageBase64: CURRENT_IMAGE })],
      lastCompletedSlides: []
    }))

    await setActiveProjectId(project.id)
    await clearActiveProjectId()

    expect(await getActiveProjectId()).toBeNull()
    expect(await getProject(project.id)).toEqual(project)
  })

  it('keeps current and last-completed images with the same slide id in distinct assets', async () => {
    const project = buildProjectRecord({
      id: 'bucketed-assets',
      slides: [
        imageSlide({
          id: 'shared-slide',
          imageBase64: CURRENT_IMAGE,
          imageUrl: `data:image/png;base64,${CURRENT_IMAGE}`
        })
      ],
      lastCompletedSlides: [
        imageSlide({
          id: 'shared-slide',
          imageBase64: COMPLETED_IMAGE,
          imageUrl: `data:image/png;base64,${COMPLETED_IMAGE}`
        })
      ]
    })

    const saved = await saveProjectRecord(project)
    const currentKey = currentAssetKey('bucketed-assets', 'shared-slide')
    const completedKey = completedAssetKey('bucketed-assets', 'shared-slide')

    expect(saved.slides[0].imageStorageKey).toBe(currentKey)
    expect(saved.lastCompletedSlides[0].imageStorageKey).toBe(completedKey)
    expect(await readStoredAsset(currentKey)).toMatchObject({ imageBase64: CURRENT_IMAGE })
    expect(await readStoredAsset(completedKey)).toMatchObject({ imageBase64: COMPLETED_IMAGE })

    const hydrated = await hydrateProjectImages(saved)
    expect(hydrated.slides[0].imageBase64).toBe(CURRENT_IMAGE)
    expect(hydrated.lastCompletedSlides[0].imageBase64).toBe(COMPLETED_IMAGE)
    expect(hydrated.slides[0].imageUrl).toBe(`data:image/png;base64,${CURRENT_IMAGE}`)
    expect(hydrated.lastCompletedSlides[0].imageUrl).toBe(`data:image/png;base64,${COMPLETED_IMAGE}`)
  })
})
