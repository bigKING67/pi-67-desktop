import styles from "./ShortcutKeyCaps.module.css";

/** One flat keycap per key, alternatives joined by 或: Settings › 快捷键 and keyboard help share it. */
export function ShortcutKeyCaps({ combos }: { combos: string[][] }) {
  return <span className={styles.combos}>{combos.map((keys, index) => (
    <span className={styles.combo} key={keys.join("+")}>
      {index > 0 ? <span className={styles.or}>或</span> : null}
      {keys.map((key) => <kbd key={key}>{key}</kbd>)}
    </span>
  ))}</span>;
}
