import { expect, it } from 'vitest'
import { flagDescriptor } from '../../features/map-icons/icon.test-fixtures'
import { parseIconResponse } from '../../features/map-icons/icon.api'
import { createIconLayers } from './eventIconLayers'

it('renders both PNG representations at full artwork brightness under night lighting', () => {
  const descriptor = parseIconResponse({ catalogRevision: 1, renderingEnabled: true, versions: [flagDescriptor] }, [flagDescriptor.versionId], 'http://127.0.0.1:56321')[0]
  const symbols = createIconLayers(descriptor, false, null).filter(layer => layer.type === 'symbol')
  expect(symbols).toHaveLength(2)
  for (const symbol of symbols) expect(symbol.paint?.['icon-emissive-strength']).toBe(1)
})
