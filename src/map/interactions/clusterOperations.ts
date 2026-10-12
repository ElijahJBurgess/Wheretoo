type ClusterFeature = { properties?: Record<string, unknown> | null }
type ExpansionSource = {
  getClusterExpansionZoom(clusterId: number, callback: (error?: Error | null, zoom?: number | null) => void): unknown
}
type LeavesSource = { getClusterLeaves(clusterId: number, limit: number, offset: number, callback: (error?: Error | null, features?: ClusterFeature[] | null) => void): unknown }

export function getClusterExpansionZoom(source: ExpansionSource, clusterId: number): Promise<number> {
  return new Promise((resolve, reject) => {
    source.getClusterExpansionZoom(clusterId, (error, zoom) => {
      if (error) reject(error)
      else if (typeof zoom !== 'number' || !Number.isFinite(zoom)) reject(new Error('Cluster expansion zoom unavailable'))
      else resolve(zoom)
    })
  })
}

function getLeaves(source: LeavesSource, clusterId: number, limit: number, offset: number): Promise<ClusterFeature[]> {
  return new Promise((resolve, reject) => {
    source.getClusterLeaves(clusterId, limit, offset, (error, features) => {
      if (error) reject(error)
      else if (!features) reject(new Error('Cluster leaves unavailable'))
      else resolve(features)
    })
  })
}

export async function getCompleteClusterEventIds(
  source: LeavesSource, clusterId: number, expectedCount: number, canonicalCount: number, isCurrent: () => boolean,
): Promise<string[]> {
  if (!Number.isInteger(expectedCount) || expectedCount < 2 || expectedCount > canonicalCount) throw new Error('Cluster membership is inconsistent')
  const ids: string[] = []
  const seen = new Set<string>()
  let offset = 0
  while (offset < expectedCount) {
    if (!isCurrent()) throw new Error('Cluster request is stale')
    const leaves = await getLeaves(source, clusterId, Math.min(100, expectedCount - offset), offset)
    if (!isCurrent()) throw new Error('Cluster request is stale')
    if (leaves.length === 0) break
    for (const leaf of leaves) {
      const eventId = leaf.properties?.eventId
      if (typeof eventId === 'string' && !seen.has(eventId)) { seen.add(eventId); ids.push(eventId) }
    }
    offset += leaves.length
    if (offset > canonicalCount) throw new Error('Cluster membership is inconsistent')
  }
  if (offset !== expectedCount || ids.length !== expectedCount) throw new Error('Cluster membership is incomplete')
  return ids
}

export type ClusterRequestToken = { interactionGeneration: number; sourceRevision: number }

export class ClusterInteractionGuard {
  private interactionGeneration = 0
  private sourceRevision = 0
  begin(): ClusterRequestToken { return { interactionGeneration: ++this.interactionGeneration, sourceRevision: this.sourceRevision } }
  invalidate() { this.interactionGeneration += 1 }
  advanceSourceRevision() { this.sourceRevision += 1; this.invalidate() }
  isCurrent(token: ClusterRequestToken) {
    return token.interactionGeneration === this.interactionGeneration && token.sourceRevision === this.sourceRevision
  }
}
