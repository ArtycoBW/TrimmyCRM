import type { TryOnTransform } from "./template-types";

type TryOnControlsProps = {
  transform: TryOnTransform;
  disabled: boolean;
  canUndo: boolean;
  onChange: (next: TryOnTransform) => void;
  onMirror: () => void;
  onReset: () => void;
  onUndo: () => void;
};

export function TryOnControls({ transform, disabled, canUndo, onChange, onMirror, onReset, onUndo }: TryOnControlsProps) {
  return (
    <section className="tryon-controls" aria-labelledby="tryon-controls-title">
      <div className="tryon-controls__heading">
        <div>
          <p>02 / Совмещение</p>
          <h2 id="tryon-controls-title">Настройте слой</h2>
        </div>
        <button type="button" onClick={onUndo} disabled={disabled || !canUndo}>Отменить</button>
      </div>

      <label>
        <span>Размер <output>{Math.round(transform.width * 100)}%</output></span>
        <input
          aria-label="Размер причёски"
          type="range"
          min="12"
          max="150"
          step="1"
          value={Math.round(transform.width * 100)}
          disabled={disabled}
          onChange={(event) => onChange({ ...transform, width: Number(event.target.value) / 100 })}
        />
      </label>
      <label>
        <span>Поворот <output>{Math.round(transform.rotation)}°</output></span>
        <input
          aria-label="Поворот причёски"
          type="range"
          min="-45"
          max="45"
          step="1"
          value={transform.rotation}
          disabled={disabled}
          onChange={(event) => onChange({ ...transform, rotation: Number(event.target.value) })}
        />
      </label>
      <label>
        <span>Прозрачность <output>{Math.round(transform.opacity * 100)}%</output></span>
        <input
          aria-label="Прозрачность причёски"
          type="range"
          min="25"
          max="100"
          step="1"
          value={Math.round(transform.opacity * 100)}
          disabled={disabled}
          onChange={(event) => onChange({ ...transform, opacity: Number(event.target.value) / 100 })}
        />
      </label>

      <div className="tryon-controls__buttons">
        <button type="button" onClick={onMirror} disabled={disabled} aria-pressed={transform.mirrored}>Отразить</button>
        <button type="button" onClick={onReset} disabled={disabled}>Сбросить слой</button>
      </div>
      <p className="tryon-controls__hint">На холсте: стрелки — двигать, +/− — размер, [ ] — поворот, M — отразить.</p>
    </section>
  );
}
