/**
 * useAutoSave Hook - 自动保存状态到 IndexedDB
 * 
 * Requirements: 10.1
 * 
 * 监听状态变化，使用防抖机制保存到 IndexedDB
 */

import { useEffect, useRef, useCallback } from 'react'
import { createProjectId, getProject, saveProjectRecord, setActiveProjectId } from '../services/projectStore'
import { Slide, GenerationConfig, ProjectRecord, ProjectStatus, WorkflowState } from '../types'

/**
 * 防抖延迟时间（毫秒）
 */
const DEBOUNCE_DELAY = 1000

/**
 * 自动保存 Hook 参数
 */
interface UseAutoSaveParams {
  projectId: string | null
  fileContent: string
  fileName: string
  slides: Slide[]
  lastCompletedSlides: Slide[]
  generationConfig: GenerationConfig
  workflow: WorkflowState
  status: ProjectStatus
  generationRunId: string | null
  onProjectIdChange?: (projectId: string) => void
  enabled?: boolean
}

/**
 * 自动保存 Hook 返回值
 */
interface UseAutoSaveReturn {
  isSaving: boolean
  lastSaved: Date | null
  saveNow: () => Promise<void>
}

function isResetWorkflow(workflow: WorkflowState): boolean {
  return workflow.status === 'idle' &&
    workflow.outline === null &&
    workflow.slidePrompts.length === 0 &&
    workflow.expandedOutlinePages.length === 0 &&
    workflow.expandedDesignPages.length === 0 &&
    workflow.error === null
}

function projectTitleFromFileName(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '').trim()
  return baseName || 'Untitled project'
}

/**
 * 自动保存 Hook
 * 
 * 监听状态变化，使用防抖机制自动保存到 IndexedDB
 */
export function useAutoSave({
  projectId,
  fileContent,
  fileName,
  slides,
  lastCompletedSlides,
  generationConfig,
  workflow,
  status,
  generationRunId,
  onProjectIdChange,
  enabled = true
}: UseAutoSaveParams): UseAutoSaveReturn {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSavingRef = useRef(false)
  const lastSavedRef = useRef<Date | null>(null)

  /**
   * 执行保存操作
   */
  const performSave = useCallback(async () => {
    // 只有当有内容时才保存
    if (!fileContent && slides.length === 0 && lastCompletedSlides.length === 0 && isResetWorkflow(workflow)) {
      return
    }

    isSavingRef.current = true

    try {
      const now = Date.now()
      const id = projectId || createProjectId()
      const existingProject = projectId ? await getProject(projectId) : null
      const project: ProjectRecord = {
        version: 2,
        id,
        title: existingProject?.title || projectTitleFromFileName(fileName),
        fileName,
        fileContent,
        slides,
        generationConfig,
        workflow,
        status,
        generationRunId,
        lastCompletedSlides,
        createdAt: existingProject?.createdAt || now,
        updatedAt: now,
        lastOpenedAt: now
      }

      const savedProject = await saveProjectRecord(project)
      await setActiveProjectId(savedProject.id)
      if (!projectId) {
        onProjectIdChange?.(savedProject.id)
      }
      lastSavedRef.current = new Date()
    } finally {
      isSavingRef.current = false
    }
  }, [
    fileContent,
    fileName,
    generationConfig,
    generationRunId,
    lastCompletedSlides,
    onProjectIdChange,
    projectId,
    slides,
    status,
    workflow
  ])

  const saveBestEffort = useCallback(() => {
    void performSave().catch((error) => {
      console.error('Failed to save project:', error)
    })
  }, [performSave])

  /**
   * 立即保存（跳过防抖）
   */
  const saveNow = useCallback(async () => {
    // 清除待执行的防抖保存
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    await performSave()
  }, [performSave])

  /**
   * 防抖保存
   */
  const debouncedSave = useCallback(() => {
    // 清除之前的定时器
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // 设置新的定时器
    timeoutRef.current = setTimeout(() => {
      saveBestEffort()
      timeoutRef.current = null
    }, DEBOUNCE_DELAY)
  }, [saveBestEffort])

  /**
   * 监听状态变化，触发防抖保存
   */
  useEffect(() => {
    if (!enabled) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      return
    }

    // 触发防抖保存
    debouncedSave()
  }, [fileContent, fileName, slides, lastCompletedSlides, generationConfig, workflow, status, generationRunId, enabled, debouncedSave])

  /**
   * 组件卸载时保存
   */
  useEffect(() => {
    return () => {
      // 组件卸载时，如果有待保存的内容，立即保存
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
        saveBestEffort()
      }
    }
  }, [saveBestEffort])

  /**
   * 页面进入后台或被卸载时保存
   */
  useEffect(() => {
    const flushPendingSave = () => {
      if (enabled && (fileContent || slides.length > 0 || lastCompletedSlides.length > 0 || !isResetWorkflow(workflow))) {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
        saveBestEffort()
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingSave()
      }
    }

    window.addEventListener('pagehide', flushPendingSave)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('pagehide', flushPendingSave)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled, fileContent, slides.length, lastCompletedSlides.length, workflow, saveBestEffort])

  return {
    isSaving: isSavingRef.current,
    lastSaved: lastSavedRef.current,
    saveNow
  }
}

export default useAutoSave
