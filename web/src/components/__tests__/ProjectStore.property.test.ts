import { describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import type { ProjectRecord, Slide } from '../../types'
import {
  EMPTY_WORKFLOW_STATE,
  TEST_GENERATION_CONFIG,
  buildDeckOutline,
  buildProjectRecord,
  buildSlide,
  buildSlidePrompt
} from '../../services/projectStore.test-utils'

describe('ProjectStore durable type shape', () => {
  it('builds a project record with workflow and asset-backed slides', () => {
    const slide: Slide = {
      id: 'slide-1',
      pageNumber: 1,
      imageUrl: 'data:image/png;base64,aaa',
      imageBase64: 'aaa',
      imageStorageKey: 'slides/project-1/slide-1.png',
      imageAsset: {
        key: 'slides/project-1/slide-1.png',
        mimeType: 'image/png',
        byteLength: 3,
        sha256: 'sha256-aaa'
      },
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
    expect(project.slides[0].imageStorageKey).toBe('slides/project-1/slide-1.png')
    expect(project.slides[0].imageAsset).toEqual({
      key: 'slides/project-1/slide-1.png',
      mimeType: 'image/png',
      byteLength: 3,
      sha256: 'sha256-aaa'
    })
  })

  it('provides deterministic project store test fixtures', () => {
    const outline = buildDeckOutline()
    const slidePrompt = buildSlidePrompt()
    const slide = buildSlide()
    const project = buildProjectRecord()

    expect(TEST_GENERATION_CONFIG.pageCount).toBe(1)
    expect(outline).toEqual({
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
    })
    expect(slidePrompt).toEqual({
      page: 1,
      title: 'Cover',
      content_summary: 'A cover page',
      display_content: 'A cover page',
      prompt: 'Generate a cover page'
    })
    expect(slide.prompt).toBe('Generate a cover page')
    expect(project).toMatchObject({
      version: 2,
      title: 'Demo deck',
      fileName: 'L9.md',
      fileContent: '# L9',
      status: 'generated',
      createdAt: 1712131200000,
      updatedAt: 1712131200000,
      lastOpenedAt: 1712131200000
    })
    expect(project.slides).toEqual([slide])
    expect(project.lastCompletedSlides).toEqual(project.slides)
  })

  it('falls back for falsy project record overrides according to the plan', () => {
    const project = buildProjectRecord({
      id: '',
      title: '',
      fileName: '',
      fileContent: '',
      slides: [],
      generationConfig: undefined,
      workflow: undefined,
      status: undefined,
      generationRunId: '',
      lastCompletedSlides: undefined,
      createdAt: 0,
      updatedAt: 0,
      lastOpenedAt: 0
    })

    expect(project.id).toBe('project-1')
    expect(project.title).toBe('Demo deck')
    expect(project.fileName).toBe('L9.md')
    expect(project.fileContent).toBe('# L9')
    expect(project.slides).toEqual([])
    expect(project.generationConfig).toBe(TEST_GENERATION_CONFIG)
    expect(project.workflow).toBe(EMPTY_WORKFLOW_STATE)
    expect(project.status).toBe('generated')
    expect(project.generationRunId).toBe('')
    expect(project.lastCompletedSlides).toBe(project.slides)
    expect(project.createdAt).toBe(1712131200000)
    expect(project.updatedAt).toBe(1712131200000)
    expect(project.lastOpenedAt).toBe(1712131200000)

    const emptySlideOverrides = buildProjectRecord({
      slides: [],
      lastCompletedSlides: []
    })
    expect(emptySlideOverrides.slides).toEqual([])
    expect(emptySlideOverrides.lastCompletedSlides).toEqual([])
  })
})
