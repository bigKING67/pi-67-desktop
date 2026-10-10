import { IMAGE_ADJUST_LIMITS, type ImageAdjust, type ImageRasterObject } from "@pi67/domain";
import { useEffect, useRef, useState } from "react";
import { Button, Label, Slider, SliderOutput, SliderThumb, SliderTrack } from "react-aria-components";
import { editImageProject, useImageProject, type ImageEditOutcome } from "./image-project-controller.js";
import styles from "./ImageInspector.module.css";

// Factors read as −100…+100 around "unchanged", as in photo editors; blur is in canvas pixels.
const SLIDERS: readonly { key: keyof ImageAdjust; label: string }[] = [
  { key: "brightness", label: "亮度" }, { key: "contrast", label: "对比度" }, { key: "saturation", label: "饱和度" }, { key: "blur", label: "模糊" }
];
const shown = (key: keyof ImageAdjust, adjust: ImageAdjust | undefined): number =>
  key === "blur" ? adjust?.blur ?? 0 : Math.round(((adjust?.[key] ?? 1) - 1) * 100);
const stored = (key: keyof ImageAdjust, value: number): number => key === "blur" ? value : Math.round(100 + value) / 100;

/**
 * 调整 for an image layer: brightness, contrast, saturation and blur, drawn over the
 * image without changing it. A slider writes one revision when it is let go.
 */
export function ImageAdjustments({ object, busy, onResult }: { object: ImageRasterObject; busy: boolean; onResult: (result: ImageEditOutcome) => void }) {
  const disabled = busy || object.locked;
  const commit = async (summary: string, adjust: ImageAdjust | null) => {
    const result = await editImageProject(summary, [{ type: "update_object", id: object.id, patch: { adjust } }]);
    onResult(result);
    return result;
  };
  // Each slider changes one adjustment over the others as they are now, not as they were rendered.
  const current = (): ImageAdjust | undefined => {
    const latest = useImageProject.getState().document?.objects.find((item) => item.id === object.id);
    return latest?.kind === "image" ? latest.adjust : object.adjust;
  };
  return (
    <div className={styles.fontRow}>
      <p className={styles.sectionLabel}>调整</p>
      {SLIDERS.map(({ key, label }) => (
        <AdjustSlider key={`${object.id}-${key}`} disabled={disabled} label={label} name={key} written={() => current()?.[key]} value={shown(key, object.adjust)}
          onCommit={(value) => commit(`调整${label}`, { ...current(), [key]: stored(key, value) })} />
      ))}
      {object.adjust ? <Button className={styles.historyAction!} isDisabled={disabled} onPress={() => void commit("还原调整", null)}>还原调整</Button> : null}
    </div>
  );
}

function AdjustSlider({ name, label, value, written, disabled, onCommit }: {
  name: keyof ImageAdjust; label: string; value: number; written: () => number | undefined; disabled: boolean; onCommit: (value: number) => Promise<ImageEditOutcome>;
}) {
  // The thumb follows the pointer locally; the document changes once, on release.
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const latest = useRef(value);
  latest.current = value;
  // Key presses end a change each: while one is being written the next waits, and only the last waiting one is sent.
  const sending = useRef(false), waiting = useRef<number | undefined>(undefined);
  const send = async (next: number): Promise<void> => {
    // Compared with the written value, so a slider can clear an Agent's factor that only rounds to 0.
    if (!sending.current && stored(name, next) === (written() ?? stored(name, 0))) return;
    if (sending.current) { waiting.current = next; return; }
    sending.current = true;
    try {
      // Refused or overtaken, the thumb returns to what the document holds.
      if ((await onCommit(next)).outcome !== "applied") setDraft(latest.current);
    } finally {
      sending.current = false;
      const queued = waiting.current;
      waiting.current = undefined;
      if (queued !== undefined) await send(queued);
    }
  };
  const [minimum, maximum] = name === "blur" ? IMAGE_ADJUST_LIMITS.blur : [-100, 100];
  return (
    <Slider className={styles.adjust!} isDisabled={disabled} maxValue={maximum} minValue={minimum} step={1} value={draft}
      onChange={(next) => setDraft(next as number)} onChangeEnd={(next) => void send(next as number)}>
      <Label>{label}</Label>
      <SliderOutput>{({ state }) => name === "blur" ? `${state.values[0]} px` : `${(state.values[0] ?? 0) > 0 ? "+" : ""}${state.values[0]}`}</SliderOutput>
      <SliderTrack className={styles.adjustTrack!}>
        {({ state }) => (
          <>
            <span className={styles.adjustFill} style={fillStyle(name, state.getThumbPercent(0))} />
            <SliderThumb className={styles.adjustThumb!} />
          </>
        )}
      </SliderTrack>
    </Slider>
  );
}

/** The filled part runs from the neutral point (the middle, or the left end for blur) to the thumb. */
function fillStyle(name: keyof ImageAdjust, percent: number): { left: string; width: string } {
  const origin = name === "blur" ? 0 : 0.5;
  return { left: `${Math.min(origin, percent) * 100}%`, width: `${Math.abs(percent - origin) * 100}%` };
}
