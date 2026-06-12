import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '../../contexts/AppStateContext'
import { useAppState } from '../../contexts/useAppState'
import { useEdit } from '../../hooks/useEdit'
import { EditHistoryItem, Slide } from '../../types'

function useEditHarness() {
  const app = useAppState()
  const edit = useEdit()

  return { app, edit }
}

const persistedHistory: EditHistoryItem[] = [
  {
    imageUrl: 'data:image/png;base64,cGVyc2lzdGVkLWltYWdl',
    imageBase64: 'cGVyc2lzdGVkLWltYWdl',
    instruction: 'make the title brighter',
    timestamp: 1700000000000
  }
]

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
})
