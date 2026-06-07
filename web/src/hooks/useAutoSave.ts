/**
 * useAutoSave Hook - 自动保存状态到 localStorage
 * 
 * Requirements: 10.1
 * 
 * 监听状态变化，使用防抖机制保存到 localStorage
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
 * 监听状态变化，使用防抖机制自动保存到 localStorage
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
    } catch (error) {
      console.error('Failed to save project:', error)
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
      void performSave()
      timeoutRef.current = null
    }, DEBOUNCE_DELAY)
  }, [performSave])

  /**
   * 监听状态变化，触发防抖保存
   */
  useEffect(() => {
    if (!enabled) {
      return
    }

    // 触发防抖保存
    debouncedSave()

    // 清理函数
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [fileContent, fileName, slides, lastCompletedSlides, generationConfig, workflow, status, generationRunId, enabled, debouncedSave])

  /**
   * 组件卸载时保存
   */
  useEffect(() => {
    return () => {
      // 组件卸载时，如果有待保存的内容，立即保存
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        void performSave()
      }
    }
  }, [performSave])

  /**
   * 页面关闭前保存
   */
  useEffect(() => {
    const handleBeforeUnload = () => {
      // 页面关闭前立即保存
      if (enabled && (fileContent || slides.length > 0 || lastCompletedSlides.length > 0 || !isResetWorkflow(workflow))) {
        void performSave()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [enabled, fileContent, slides.length, lastCompletedSlides.length, workflow, performSave])

  return {
    isSaving: isSavingRef.current,
    lastSaved: lastSavedRef.current,
    saveNow
  }
}

export default useAutoSave
