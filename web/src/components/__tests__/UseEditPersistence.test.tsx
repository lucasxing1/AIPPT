import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '../../contexts/AppStateContext'
import { useAppState } from '../../contexts/useAppState'
import { useEdit } from '../../hooks/useEdit'
import { useEditConflict } from '../../hooks/useEditConflict'
import { EditHistoryItem, Slide } from '../../types'

function useEditHarness() {
  const app = useAppState()
  const edit = useEdit()
  const conflict = useEditConflict()

  return { app, edit, conflict }
}

const persistedHistoryA: EditHistoryItem = {
  imageUrl: 'data:image/png;base64,cGVyc2lzdGVkLWltYWdlLWE=',
  imageBase64: 'cGVyc2lzdGVkLWltYWdlLWE=',
  instruction: 'make the title brighter',
  timestamp: 1700000000000
}

const persistedHistoryB: EditHistoryItem = {
  imageUrl: 'data:image/png;base64,cGVyc2lzdGVkLWltYWdlLWI=',
  imageBase64: 'cGVyc2lzdGVkLWltYWdlLWI=',
  instruction: 'make the chart clearer',
  timestamp: 1700000001000
}

const persistedHistory: EditHistoryItem[] = [persistedHistoryA]
const twoItemPersistedHistory: EditHistoryItem[] = [persistedHistoryA, persistedHistoryB]

function buildSlide(overrides: Partial<Slide> = {}): Slide {
  return {
    id: 'slide-1',
    pageNumber: 1,
    imageUrl: 'data:image/png;base64,Y3VycmVudC1pbWFnZQ==',
    imageBase64: 'Y3VycmVudC1pbWFnZQ==',
    prompt: 'Intro slide',
    ...overrides
  }
}

describe('useEdit persisted edit history', () => {
  it('initializes a new edit session from the slide edit history', () => {
    const slide = buildSlide({ editHistory: persistedHistory })
    const { result } = renderHook(() => useEditHarness(), { wrapper: AppStateProvider })

    act(() => {
      result.current.edit.beginEdit(slide)
    })

    expect(result.current.edit.editSession?.history).toEqual(persistedHistory)
  })

  it('confirms the edited image with persisted and session history without duplicating the persisted prefix', () => {
    const sessionHistoryItem: EditHistoryItem = {
      imageUrl: 'data:image/png;base64,Y3VycmVudC1pbWFnZQ==',
      imageBase64: 'Y3VycmVudC1pbWFnZQ==',
      instruction: 'add presenter notes visual',
      timestamp: 1700000001000
    }
    const slide = buildSlide({ editHistory: persistedHistory })
    const { result } = renderHook(() => useEditHarness(), { wrapper: AppStateProvider })

    act(() => {
      result.current.app.addSlide(slide)
      result.current.edit.beginEdit(slide)
    })

    act(() => {
      result.current.app.updateEdit({
        currentImage: 'ZWRpdGVkLWltYWdl',
        history: [...persistedHistory, sessionHistoryItem]
      })
    })

    act(() => {
      result.current.edit.confirmEdit()
    })

    const updatedSlide = result.current.app.state.slides.find(item => item.id === slide.id)
    expect(updatedSlide?.imageBase64).toBe('ZWRpdGVkLWltYWdl')
    expect(updatedSlide?.imageUrl).toBe('data:image/png;base64,ZWRpdGVkLWltYWdl')
    expect(updatedSlide?.editHistory).toEqual([...persistedHistory, sessionHistoryItem])
    expect(updatedSlide?.editHistory).toHaveLength(2)
    expect(result.current.app.state.selectedSlideId).toBe(slide.id)
    expect(result.current.edit.editSession).toBeNull()
  })

  it('persists truncated history after reverting to a persisted version', () => {
    const slide = buildSlide({ editHistory: twoItemPersistedHistory })
    const { result } = renderHook(() => useEditHarness(), { wrapper: AppStateProvider })

    act(() => {
      result.current.app.addSlide(slide)
      result.current.edit.beginEdit(slide)
    })

    act(() => {
      result.current.edit.revertToVersion(persistedHistoryB)
    })

    act(() => {
      result.current.edit.confirmEdit()
    })

    const updatedSlide = result.current.app.state.slides.find(item => item.id === slide.id)
    expect(updatedSlide?.imageBase64).toBe(persistedHistoryB.imageBase64)
    expect(updatedSlide?.editHistory).toEqual([persistedHistoryA])
  })

  it('clears persisted history after reverting to the first persisted version', () => {
    const slide = buildSlide({ editHistory: twoItemPersistedHistory })
    const { result } = renderHook(() => useEditHarness(), { wrapper: AppStateProvider })

    act(() => {
      result.current.app.addSlide(slide)
      result.current.edit.beginEdit(slide)
    })

    act(() => {
      result.current.edit.revertToVersion(persistedHistoryA)
    })

    act(() => {
      result.current.edit.confirmEdit()
    })

    const updatedSlide = result.current.app.state.slides.find(item => item.id === slide.id)
    expect(updatedSlide?.imageBase64).toBe(persistedHistoryA.imageBase64)
    expect(updatedSlide?.editHistory).toEqual([])
  })

  it('keeps the edit session open with an error when confirming a missing slide', () => {
    const slide = buildSlide({ editHistory: persistedHistory })
    const { result } = renderHook(() => useEditHarness(), { wrapper: AppStateProvider })

    act(() => {
      result.current.edit.beginEdit(slide)
    })

    act(() => {
      result.current.edit.confirmEdit()
    })

    expect(result.current.edit.editSession?.slideId).toBe(slide.id)
    expect(result.current.edit.editError).toBe('无法确认编辑：幻灯片不存在')
    expect(result.current.app.state.selectedSlideId).toBeNull()
  })

  it('does not treat seeded persisted history as unsaved edit changes', () => {
    const slide = buildSlide({ editHistory: persistedHistory })
    const sessionHistoryItem: EditHistoryItem = {
      imageUrl: 'data:image/png;base64,Y3VycmVudC1pbWFnZQ==',
      imageBase64: 'Y3VycmVudC1pbWFnZQ==',
      instruction: 'add presenter notes visual',
      timestamp: 1700000002000
    }
    const { result } = renderHook(() => useEditHarness(), { wrapper: AppStateProvider })

    act(() => {
      result.current.edit.beginEdit(slide)
    })

    expect(result.current.conflict.hasUnsavedEdits(result.current.edit.editSession)).toBe(false)

    act(() => {
      result.current.app.updateEdit({
        currentImage: 'ZWRpdGVkLWltYWdl',
        history: [...persistedHistory, sessionHistoryItem]
      })
    })

    expect(result.current.conflict.hasUnsavedEdits(result.current.edit.editSession)).toBe(true)
  })

  it('clones slide edit history when starting an edit session', () => {
    const slide = buildSlide({ editHistory: [{ ...persistedHistoryA }] })
    const { result } = renderHook(() => useEditHarness(), { wrapper: AppStateProvider })

    act(() => {
      result.current.edit.beginEdit(slide)
    })

    slide.editHistory?.push(persistedHistoryB)
    if (slide.editHistory?.[0]) {
      slide.editHistory[0].instruction = 'mutated outside session'
    }

    expect(result.current.edit.editSession?.history).toEqual([persistedHistoryA])
  })
})
