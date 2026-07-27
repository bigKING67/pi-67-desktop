import { messages } from "../localization/message-catalog.js";
import styles from "./ApprovalDialog.module.css";
import type { SecurityLiteralAnalysis } from "./security-literal.js";

interface SecurityLiteralProps {
  analysis: SecurityLiteralAnalysis;
  kind: "tool-name" | "target" | "cwd";
  label: string;
  multiline?: boolean;
  emptyFallback?: string;
}

export function SecurityLiteral({
  analysis,
  kind,
  label,
  multiline = false,
  emptyFallback = messages.approval.emptyLiteral
}: SecurityLiteralProps) {
  const content = analysis.display || emptyFallback;
  const ariaLabel = analysis.suspicious ? messages.approval.safeViewLabel(label) : label;
  const literal = multiline ? (
    <pre
      aria-label={ariaLabel}
      className={styles.securityLiteral}
      data-security-literal={kind}
      dir="ltr"
    >{content}</pre>
  ) : (
    <code
      aria-label={ariaLabel}
      className={styles.securityLiteral}
      data-security-literal={kind}
      dir="ltr"
    >{content}</code>
  );

  return (
    <>
      {literal}
      {analysis.suspicious ? (
        <small className={styles.literalStatus}>
          {messages.approval.suspiciousLiteral(analysis.suspiciousCharacterCount)}
        </small>
      ) : null}
    </>
  );
}
