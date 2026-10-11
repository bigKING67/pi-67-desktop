import { Button } from "react-aria-components";
import { useBrandKit } from "./image-brand.js";
import styles from "./ImageInspector.module.css";

/** The brand kit's colours under a colour field: one press sets that colour (P5). Nothing shows without a kit. */
export function BrandSwatches({ current, disabled, onPick }: { current: string | undefined; disabled: boolean; onPick: (value: string) => void }) {
  const colors = useBrandKit((kit) => kit.colors);
  if (!colors?.length) return null;
  return (
    <div aria-label="品牌颜色" className={styles.swatches} role="group">
      {colors.map((color) => {
        const selected = current?.toLowerCase() === color.value.toLowerCase();
        return (
          <Button key={color.id} aria-label={`${color.name} ${color.value}`} aria-pressed={selected} className={`${styles.swatch} ${selected ? styles.swatchSelected : ""}`}
            isDisabled={disabled} onPress={() => { if (!selected) onPick(color.value); }} style={{ background: color.value }} />
        );
      })}
    </div>
  );
}
