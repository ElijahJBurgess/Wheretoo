export type MapBounds = { west: number; south: number; east: number; north: number }
export type MapCenter = { longitude: number; latitude: number }
export type MapViewportSnapshot = { bounds: MapBounds; center: MapCenter; zoom: number; camera?: MapCamera }
export type MapCamera = { center: [number, number]; zoom: number; pitch: number; bearing: number }
export type MapRendererErrorCode = 'WEBGL_UNSUPPORTED' | 'TOKEN_INVALID' | 'STYLE_LOAD_FAILED' | 'RENDERER_FAILED' | 'DATA_INVALID'
export type MapRendererError = { code: MapRendererErrorCode; message: string }
