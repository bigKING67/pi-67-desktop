import alibabaCloud from "@lobehub/icons-static-svg/icons/alibabacloud-color.svg";
import antGroup from "@lobehub/icons-static-svg/icons/antgroup-color.svg";
import azure from "@lobehub/icons-static-svg/icons/azure-color.svg";
import baseten from "@lobehub/icons-static-svg/icons/baseten.svg";
import bedrock from "@lobehub/icons-static-svg/icons/bedrock-color.svg";
import cerebras from "@lobehub/icons-static-svg/icons/cerebras-color.svg";
import claude from "@lobehub/icons-static-svg/icons/claude-color.svg";
import cloudflare from "@lobehub/icons-static-svg/icons/cloudflare-color.svg";
import codex from "@lobehub/icons-static-svg/icons/codex-color.svg";
import deepseek from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import doubao from "@lobehub/icons-static-svg/icons/doubao-color.svg";
import fireworks from "@lobehub/icons-static-svg/icons/fireworks-color.svg";
import gemini from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import githubCopilot from "@lobehub/icons-static-svg/icons/githubcopilot.svg";
import grok from "@lobehub/icons-static-svg/icons/grok.svg";
import groq from "@lobehub/icons-static-svg/icons/groq.svg";
import huggingface from "@lobehub/icons-static-svg/icons/huggingface-color.svg";
import kimi from "@lobehub/icons-static-svg/icons/kimi-color.svg";
import meta from "@lobehub/icons-static-svg/icons/meta-color.svg";
import minimax from "@lobehub/icons-static-svg/icons/minimax-color.svg";
import mistral from "@lobehub/icons-static-svg/icons/mistral-color.svg";
import nvidia from "@lobehub/icons-static-svg/icons/nvidia-color.svg";
import ollama from "@lobehub/icons-static-svg/icons/ollama.svg";
import openai from "@lobehub/icons-static-svg/icons/openai.svg";
import opencode from "@lobehub/icons-static-svg/icons/opencode.svg";
import openrouter from "@lobehub/icons-static-svg/icons/openrouter.svg";
import qwen from "@lobehub/icons-static-svg/icons/qwen-color.svg";
import together from "@lobehub/icons-static-svg/icons/together-color.svg";
import vercel from "@lobehub/icons-static-svg/icons/vercel.svg";
import volcengine from "@lobehub/icons-static-svg/icons/volcengine-color.svg";
import xiaomi from "@lobehub/icons-static-svg/icons/xiaomimimo.svg";
import zhipu from "@lobehub/icons-static-svg/icons/zhipu-color.svg";
import styles from "./ProviderBrandIcon.module.css";

interface BrandMark {
  src: string;
  /** Single-color marks follow the current text color instead of a fixed fill. */
  mono?: true;
}

/**
 * Ordered so specific identities win over the families they contain
 * (Codex before OpenAI, Doubao before Volcengine, Copilot before GitHub).
 */
const BRAND_RULES: ReadonlyArray<readonly [RegExp, BrandMark]> = [
  [/codex/, { src: codex }],
  [/copilot/, { src: githubCopilot, mono: true }],
  [/anthropic|claude/, { src: claude }],
  [/deepseek/, { src: deepseek }],
  [/doubao/, { src: doubao }],
  [/volcengine|volces|\bark\b/, { src: volcengine }],
  [/kimi|moonshot/, { src: kimi }],
  [/zhipu|bigmodel|glm|\bz-?ai\b/, { src: zhipu }],
  [/qwen|dashscope/, { src: qwen }],
  [/aliyun|alibaba/, { src: alibabaCloud }],
  [/minimax/, { src: minimax }],
  [/openrouter/, { src: openrouter, mono: true }],
  [/gemini|google|vertex/, { src: gemini }],
  [/grok|\bxai\b|x\.ai/, { src: grok, mono: true }],
  [/groq/, { src: groq, mono: true }],
  [/mistral|codestral/, { src: mistral }],
  [/bedrock|amazon/, { src: bedrock }],
  [/azure/, { src: azure }],
  [/cerebras/, { src: cerebras }],
  [/fireworks/, { src: fireworks }],
  [/together/, { src: together }],
  [/huggingface/, { src: huggingface }],
  [/nvidia/, { src: nvidia }],
  [/\bmeta\b|llama/, { src: meta }],
  [/cloudflare/, { src: cloudflare }],
  [/xiaomi|mimo/, { src: xiaomi, mono: true }],
  [/\bant-?ling\b|antgroup/, { src: antGroup }],
  [/opencode/, { src: opencode, mono: true }],
  [/baseten/, { src: baseten, mono: true }],
  [/vercel/, { src: vercel, mono: true }],
  [/ollama/, { src: ollama, mono: true }],
  [/openai|\bgpt|\bo[134]\b/, { src: openai, mono: true }]
];

/** First matching identity wins, so callers pass the most specific hint (e.g. model ID) first. */
export function resolveProviderBrand(hints: ReadonlyArray<string | undefined>): BrandMark | undefined {
  for (const hint of hints) {
    if (!hint) continue;
    const normalized = hint.toLocaleLowerCase();
    const match = BRAND_RULES.find(([pattern]) => pattern.test(normalized));
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Decorative brand mark for a Provider or model; the adjacent text always names it.
 * Unknown identities get a neutral monogram so rows keep one leading rhythm.
 */
export function ProviderBrandIcon({ hints, label, size = "row" }: {
  hints: ReadonlyArray<string | undefined>;
  /** Display name used for the monogram fallback. */
  label: string;
  size?: "row" | "inline";
}) {
  const brand = resolveProviderBrand(hints);
  if (!brand) {
    return <span aria-hidden="true" className={styles.monogram} data-size={size}>
      {Array.from(label.trim())[0]?.toLocaleUpperCase() ?? "?"}
    </span>;
  }
  if (brand.mono) {
    return <span
      aria-hidden="true"
      className={styles.mono}
      data-size={size}
      style={{ maskImage: `url("${brand.src}")` }}
    />;
  }
  return <img alt="" aria-hidden="true" className={styles.mark} data-size={size} draggable={false} src={brand.src} />;
}
