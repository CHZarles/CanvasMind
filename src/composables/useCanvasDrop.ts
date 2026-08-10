/**
 * 画布拖入文件：dragover/drop → 计算落点世界坐标 → 上传 → 新节点
 *
 * 绑定到 VueFlow 容器最外层：
 *   <div @dragover="onDragOver" @drop="onDrop">
 *     <VueFlow ... />
 *   </div>
 *
 * 多文件时按 x 方向错落 40px，避免节点完全重叠。
 */
import { useVueFlow } from '@vue-flow/core'
import { ElMessage } from 'element-plus'
import { addNode, updateNode } from '@/views/workflow/composables/useWorkflowCanvas'
import { uploadNodeMedia } from '@/views/workflow/composables/useAgentRuntime'
import type { DroppedFileDescriptor, DroppedFileKind } from '@/types/canvas-interaction'

const MULTI_FILE_X_STEP = 40

function classifyFile(file: File): DroppedFileKind {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'unsupported'
}

export function useCanvasDrop() {
  const { screenToFlowCoordinate } = useVueFlow()

  /**
   * Drop 事件处理器
   * @returns 已落地的文件描述列表（含节点未创建的失败项时也会返回 unsupported 之外的有效项）
   */
  const onDrop = async (event: DragEvent): Promise<DroppedFileDescriptor[]> => {
    event.preventDefault()
    if (!event.dataTransfer) return []
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return []

    const dropped: DroppedFileDescriptor[] = []
    let xOffset = 0
    for (const file of files) {
      const kind = classifyFile(file)
      if (kind === 'unsupported') {
        ElMessage.warning(`不支持的文件类型：${file.name}`)
        continue
      }
      const position = screenToFlowCoordinate({
        x: event.clientX + xOffset,
        y: event.clientY,
      })
      xOffset += MULTI_FILE_X_STEP
      dropped.push({ file, kind, position })

      const nodeId = addNode(kind, position, {
        url: URL.createObjectURL(file),
        label: file.name,
        loading: true,
        ...(kind === 'video' ? { duration: 0 } : {}),
      })
      try {
        await uploadNodeMedia(nodeId, file)
      } catch (err) {
        updateNode(nodeId, {
          loading: false,
          error: err instanceof Error ? err.message : '上传失败',
        })
        ElMessage.error(`${file.name} 上传失败`)
        // eslint-disable-next-line no-console
        console.error('[useCanvasDrop] upload failed', err)
      }
    }
    return dropped
  }

  /** dragover：必须 preventDefault 才能让 drop 触发 */
  const onDragOver = (event: DragEvent) => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  return { onDrop, onDragOver }
}
