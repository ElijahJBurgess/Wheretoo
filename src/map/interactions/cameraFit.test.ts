import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculateMarkerRevealOffset, createSelectionCameraController } from './cameraFit'

afterEach(() => vi.unstubAllGlobals())

describe('calculateMarkerRevealOffset', () => {
  const map = { left: 0, top: 0, right: 390, bottom: 844 }

  it('does not move the camera when the full selected marker treatment is visible', () => {
    expect(calculateMarkerRevealOffset({
      map, point: { x: 195, y: 340 }, obstacles: [{ left: 12, top: 560, right: 378, bottom: 800 }], margin: 16,
    })).toBeNull()
  })

  it('uses the smallest pan that reveals the marker badge and halo above a mobile panel', () => {
    expect(calculateMarkerRevealOffset({
      map, point: { x: 195, y: 610 }, obstacles: [{ left: 12, top: 560, right: 378, bottom: 800 }], margin: 16,
    })).toEqual({ x: 0, y: -124 })
  })

  it('accounts for the marker title below the raw projected coordinate', () => {
    expect(calculateMarkerRevealOffset({
      map, point: { x: 195, y: 522 }, obstacles: [{ left: 12, top: 560, right: 378, bottom: 800 }], margin: 16,
    })).toEqual({ x: 0, y: -36 })
  })

  it('keeps a long selected title inside the horizontal viewport edge', () => {
    expect(calculateMarkerRevealOffset({ map, point: { x: 50, y: 340 }, obstacles: [], margin: 16 })).toEqual({ x: 42, y: 0 })
  })
})

describe('selection camera controller', () => {
  function setupController(reducedMotion = false) {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrame
      frames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }))
    const flushFrames = () => {
      while (frames.size > 0) {
        const callbacks = [...frames.values()]
        frames.clear()
        callbacks.forEach((callback) => callback(0))
      }
    }
    const mapElement = document.createElement('div')
    const panel = document.createElement('article')
    document.body.append(mapElement, panel)
    mapElement.getBoundingClientRect = () => ({ left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844, x: 0, y: 0, toJSON: vi.fn() })
    panel.getBoundingClientRect = () => ({ left: 12, top: 560, right: 378, bottom: 800, width: 366, height: 240, x: 12, y: 560, toJSON: vi.fn() })
    const map = {
      project: vi.fn(([longitude]: [number, number]) => ({ x: 195, y: longitude === -122.1 ? 610 : 340 })),
      panBy: vi.fn(),
      stop: vi.fn(),
    }
    return { controller: createSelectionCameraController(map, mapElement), flushFrames, map, panel }
  }

  it('lets the latest rapidly selected event win before measuring', () => {
    const { controller, flushFrames, map, panel } = setupController()
    controller.reveal({ longitude: -122.1, latitude: 37.8 }, panel)
    controller.reveal({ longitude: -122.2, latitude: 37.8 }, panel)
    flushFrames()
    expect(map.project).toHaveBeenCalledTimes(1)
    expect(map.project).toHaveBeenCalledWith([-122.2, 37.8])
    expect(map.panBy).not.toHaveBeenCalled()
  })

  it('cancels pending reveal work when the preview closes', () => {
    const { controller, flushFrames, map, panel } = setupController()
    controller.reveal({ longitude: -122.1, latitude: 37.8 }, panel)
    controller.cancel()
    flushFrames()
    expect(map.project).not.toHaveBeenCalled()
    expect(map.panBy).not.toHaveBeenCalled()
  })

  it('inverts the screen reveal translation for Mapbox panBy coordinates', () => {
    const { controller, flushFrames, map, panel } = setupController()
    controller.reveal({ longitude: -122.1, latitude: 37.8 }, panel)
    flushFrames()
    expect(map.panBy).toHaveBeenCalledWith([0, 124], { duration: 250, essential: false })
  })

  it('stops an active automatic pan before a newer selection is measured', () => {
    const { controller, flushFrames, map, panel } = setupController()
    controller.reveal({ longitude: -122.1, latitude: 37.8 }, panel)
    flushFrames()
    controller.reveal({ longitude: -122.2, latitude: 37.8 }, panel)
    expect(map.stop).toHaveBeenCalledOnce()
    flushFrames()
    expect(map.project).toHaveBeenLastCalledWith([-122.2, 37.8])
  })

  it('remembers a restored selection without refitting its saved camera, then remeasures on resize', () => {
    const { controller, flushFrames, map, panel } = setupController()
    controller.reveal({ longitude: -122.1, latitude: 37.8 }, panel, { preserveCamera: true })
    flushFrames()
    expect(map.panBy).not.toHaveBeenCalled()
    controller.remeasure(); flushFrames()
    expect(map.panBy).toHaveBeenCalledOnce()
  })

  it('removes camera travel when reduced motion is requested', () => {
    const { controller, flushFrames, map, panel } = setupController(true)
    controller.reveal({ longitude: -122.1, latitude: 37.8 }, panel)
    flushFrames()
    expect(map.panBy).toHaveBeenCalledWith([0, 124], { duration: 0, essential: false })
  })
})
