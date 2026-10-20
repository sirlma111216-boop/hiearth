import type { LayerId } from '@shared/domain/types'
import { MAP_COLORS } from '../map/colors'

export const LAYER_ITEMS: { id: LayerId; label: string; color: string; shape: 'dot' | 'triangle' | 'line' | 'dashed' | 'plate' }[] = [
  { id: 'earthquakes', label: '지진 기록', color: MAP_COLORS.quake, shape: 'dot' },
  { id: 'volcanoes', label: '화산 기록', color: MAP_COLORS.volcano, shape: 'triangle' },
  { id: 'myFirst', label: '내 최초 선', color: MAP_COLORS.first, shape: 'line' },
  { id: 'myRevised', label: '내 수정 선', color: MAP_COLORS.revised, shape: 'dashed' },
  { id: 'plates', label: '판의 경계', color: MAP_COLORS.plate, shape: 'plate' },
]

export function LayerSwatch({ shape, color }: Pick<typeof LAYER_ITEMS[number], 'shape' | 'color'>) {
  return <svg className="legend-swatch" viewBox="0 0 24 16" aria-hidden="true">
    {shape === 'dot' ? <circle cx="12" cy="8" r="4" fill={color} />
      : shape === 'triangle' ? <path d="M12 2l6 12H6z" fill={color} />
        : <path d="M2 8h20" stroke={color} strokeWidth={shape === 'plate' ? 6 : 2.6} strokeLinecap="round" strokeDasharray={shape === 'dashed' ? '5 4' : undefined} />}
  </svg>
}

interface Props {
  layers: Record<LayerId, boolean>
  unavailable: Partial<Record<LayerId, string>>
  teacher: boolean
  onLayer: (id: LayerId, on: boolean) => void
  onBase: () => void
}

export function LayerControls({ layers, unavailable, teacher, onLayer, onBase }: Props) {
  return <div className="map-layers panel" role="group" aria-label="지도 레이어">
    <button type="button" className="map-layer" aria-pressed={!Object.values(layers).some(Boolean)} onClick={onBase}>지도만 보기</button>
    {LAYER_ITEMS.map((item) => {
      const label = teacher ? item.label.replace('내 ', '학생 ') : item.label
      const reason = unavailable[item.id]
      return <button key={item.id} type="button" className="map-layer" disabled={!!reason} aria-pressed={!reason && layers[item.id]} aria-label={label} title={reason ? `${label}: ${reason}` : `${label} 켜기/끄기`} onClick={() => onLayer(item.id, !layers[item.id])}>
        <LayerSwatch shape={item.shape} color={item.color} />
        <span>{label}{reason ? <small>{reason}</small> : null}</span>
      </button>
    })}
  </div>
}
