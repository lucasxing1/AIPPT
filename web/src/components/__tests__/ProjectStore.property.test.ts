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
