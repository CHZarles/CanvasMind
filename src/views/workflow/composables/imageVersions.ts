export type CanvasMediaReference =
  | { attachment_id: string }
  | { task_type: string; task_id: string; asset_id: string }

export interface CanvasImageVersion {
  id: string
  media_ref: CanvasMediaReference
  url?: string
}

const versionId = (mediaRef: CanvasMediaReference) => (
  'asset_id' in mediaRef ? mediaRef.asset_id : mediaRef.attachment_id
)

export const appendImageVersion = (
  versions: CanvasImageVersion[],
  currentRef: CanvasMediaReference | undefined,
  currentUrl: string,
  generatedRef: CanvasMediaReference,
  generatedUrl: string,
) => {
  const next = versions.map(version => ({ ...version }))
  const known = new Set(next.map(version => version.id))
  for (const [mediaRef, url] of [[currentRef, currentUrl], [generatedRef, generatedUrl]] as const) {
    if (!mediaRef) continue
    const id = versionId(mediaRef)
    if (known.has(id)) continue
    next.push({ id, media_ref: mediaRef, url })
    known.add(id)
  }
  return next
}
