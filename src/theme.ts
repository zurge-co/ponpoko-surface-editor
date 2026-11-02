import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const PONPOKO_COLORS = {
  background: "#14100c",
  panel: "#1e1813",
  panelRaised: "#282019",
  border: "#3a2f24",
  text: "#f3e7d7",
  textMuted: "#a9927d",
  textDim: "#927e6a",
  accent: "#7dba37",
  accentSoft: "#acda52",
  attention: "#eaee5c",
  danger: "#ff6b6b",
  selection: "#7dba3726",
  selectionMatch: "#eaee5c22",
} as const;

const TOKEN_COLORS = {
  keyword: "var(--accent-soft, #acda52)",
  controlKeyword: "var(--accent-soft, #acda52)",
  typeName: "var(--accent, #8fc9a8)",
  className: "var(--accent, #8fc9a8)",
  variableName: "var(--fg, #f3e7d7)",
  propertyName: "var(--fg-muted, #d9cdbc)",
  function: "var(--attention, #edef71)",
  definition: "var(--accent, #c9e88a)",
  string: "var(--accent-soft, #e6c07a)",
  specialString: "var(--accent-soft, #e6c07a)",
  number: "var(--attention, #a6ddd0)",
  bool: "var(--attention, #a6ddd0)",
  atom: "var(--attention, #a6ddd0)",
  comment: "var(--fg-dim, #7a7263)",
  lineComment: "var(--fg-dim, #7a7263)",
  blockComment: "var(--fg-dim, #7a7263)",
  meta: "var(--fg-muted, #a9927d)",
  tag: "var(--accent, #acda52)",
  attribute: "var(--attention, #a6ddd0)",
  operator: "var(--fg-muted, #b3a894)",
  bracket: "var(--fg-dim, #a1957f)",
  punctuation: "var(--fg-dim, #a1957f)",
  heading: "var(--accent, #7dba37)",
  link: "var(--accent, #8fc9a8)",
  invalid: "var(--danger, #ff6b6b)",
} as const;

const furniture = EditorView.theme(
  {
    "&": {
      color: "var(--fg, #f3e7d7)",
      backgroundColor: "var(--bg, #14100c)",
      height: "100%",
    },
    ".cm-scroller": {
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, "Cascadia Code", "Noto Sans Mono", "Noto Sans Thai", monospace',
      lineHeight: "1.6",
      overflow: "auto",
    },
    ".cm-content": {
      padding: "10px 0 24px",
      caretColor: "var(--accent, #7dba37)",
    },
    ".cm-line": {
      padding: "0 16px 0 6px",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--accent, #7dba37)",
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "var(--accent-selection, rgba(125, 186, 55, 0.15))",
      },
    ".cm-selectionMatch": {
      backgroundColor: "var(--attention-soft, rgba(234, 238, 92, 0.08))",
      outline: "1px solid 55",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--panel-hover)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--bg, #14100c)",
      color: "var(--fg-dim, #927e6a)",
      border: "none",
      borderRight: "1px solid var(--border, #3a2f24)",
      paddingLeft: "6px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--panel-hover)",
      color: "var(--accent-soft, #acda52)",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 10px 0 4px",
      minWidth: "2.2em",
    },
    ".cm-foldGutter .cm-gutterElement": {
      color: "var(--fg-dim, #927e6a)",
      padding: "0 4px",
      cursor: "pointer",
    },
    ".cm-foldGutter .cm-gutterElement:hover": {
      color: "var(--accent, #7dba37)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--panel-raised, #282019)",
      border: "1px solid var(--border, #3a2f24)",
      color: "var(--fg-muted, #a9927d)",
      borderRadius: "4px",
      padding: "0 6px",
    },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: "var(--accent-selection, rgba(125, 186, 55, 0.2))",
      outline: "1px solid var(--accent, #7dba37)",
    },
    ".cm-nonmatchingBracket": {
      backgroundColor: "color-mix(in srgb, var(--danger) 13%, transparent)",
      outline: "1px solid var(--accent, #7dba37)",
    },
    ".cm-specialChar": {
      color: "var(--attention, #eaee5c)",
    },
    ".cm-placeholder": {
      color: "var(--fg-dim, #927e6a)",
    },
    ".cm-panels": {
      backgroundColor: "var(--panel, #1e1813)",
      color: "var(--fg, #f3e7d7)",
      borderColor: "var(--border, #3a2f24)",
    },
    ".cm-panels.cm-panels-top": {
      borderBottom: "1px solid var(--border, #3a2f24)",
    },
    ".cm-panels.cm-panels-bottom": {
      borderTop: "1px solid var(--border, #3a2f24)",
    },
    ".cm-panel.cm-search": {
      padding: "6px 8px",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Thai", sans-serif',
      fontSize: "var(--ponpoko-font-ui, 14px)",
    },
    ".cm-panel.cm-search label": {
      color: "var(--fg-muted, #a9927d)",
      display: "inline-flex",
      alignItems: "center",
      gap: "3px",
    },
    ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-textfield": {
      font: "inherit",
      color: "var(--fg, #f3e7d7)",
      backgroundColor: "var(--bg, #14100c)",
      border: "1px solid var(--border, #3a2f24)",
      borderRadius: "4px",
      padding: "2px 6px",
    },
    ".cm-panel.cm-search input:focus, .cm-textfield:focus": {
      outline: "1px solid var(--accent, #7dba37)",
      borderColor: "var(--accent, #7dba37)",
    },
    ".cm-panel.cm-search button:hover": {
      borderColor: "var(--accent, #7dba37)",
      color: "var(--accent-soft, #acda52)",
    },
    ".cm-panel.cm-search [name=close]": {
      color: "var(--fg-muted, #a9927d)",
      fontSize: "15px",
      border: "none",
      background: "transparent",
    },
    ".cm-searchMatch": {
      backgroundColor: "var(--attention-soft, rgba(234, 238, 92, 0.2))",
      outline: "1px solid var(--attention, #eaee5c)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "var(--accent-selection, rgba(125, 186, 55, 0.27))",
      outline: "1px solid var(--accent, #7dba37)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--panel-raised, #282019)",
      border: "1px solid var(--border, #3a2f24)",
      color: "var(--fg, #f3e7d7)",
      borderRadius: "6px",
    },
    ".cm-tooltip-autocomplete": {
      display: "none",
    },
    ".cm-scroller::-webkit-scrollbar": {
      width: "10px",
      height: "10px",
    },
    ".cm-scroller::-webkit-scrollbar-thumb": {
      backgroundColor: "var(--scrollbar, #4a3c2f)",
      borderRadius: "6px",
      border: "2px solid var(--bg, #14100c)",
    },
    ".cm-scroller::-webkit-scrollbar-thumb:hover": {
      backgroundColor: "var(--scrollbar-hover, #5d4c3c)",
    },
    ".cm-scroller::-webkit-scrollbar-corner": {
      backgroundColor: "var(--bg, #14100c)",
    },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: TOKEN_COLORS.keyword },
  { tag: [t.operatorKeyword, t.definitionKeyword], color: TOKEN_COLORS.keyword },
  { tag: [t.typeName, t.className, t.namespace], color: TOKEN_COLORS.typeName },
  { tag: [t.standard(t.tagName), t.tagName], color: TOKEN_COLORS.tag },
  { tag: [t.attributeName], color: TOKEN_COLORS.attribute },
  { tag: [t.propertyName], color: TOKEN_COLORS.propertyName },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: TOKEN_COLORS.function },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: TOKEN_COLORS.definition },
  { tag: [t.local(t.variableName)], color: TOKEN_COLORS.variableName },
  { tag: [t.variableName], color: TOKEN_COLORS.variableName },
  { tag: [t.labelName], color: TOKEN_COLORS.propertyName },
  { tag: [t.string, t.special(t.string)], color: TOKEN_COLORS.string },
  { tag: [t.regexp, t.escape], color: TOKEN_COLORS.specialString },
  { tag: [t.number, t.bool, t.atom, t.null], color: TOKEN_COLORS.number },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: TOKEN_COLORS.comment, fontStyle: "italic" },
  { tag: [t.meta, t.annotation], color: TOKEN_COLORS.meta },
  { tag: [t.operator], color: TOKEN_COLORS.operator },
  { tag: [t.bracket, t.squareBracket, t.brace, t.paren], color: TOKEN_COLORS.bracket },
  { tag: [t.punctuation, t.separator], color: TOKEN_COLORS.punctuation },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3], color: TOKEN_COLORS.heading, fontWeight: "600" },
  { tag: [t.strong], fontWeight: "600" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.link, t.url], color: TOKEN_COLORS.link, textDecoration: "underline" },
  { tag: [t.monospace], color: TOKEN_COLORS.specialString },
  { tag: [t.quote], color: "var(--fg-muted, #a9927d)", fontStyle: "italic" },
  { tag: [t.inserted], color: "var(--accent, #7dba37)" },
  { tag: [t.deleted], color: "var(--danger, #ff6b6b)" },
  { tag: [t.changed], color: "var(--attention, #eaee5c)" },
  { tag: [t.invalid], color: TOKEN_COLORS.invalid, textDecoration: "underline wavy" },
]);

export const ponpokoTheme: Extension = [furniture, syntaxHighlighting(highlight)];

export const ponpokoHighlight: HighlightStyle = highlight;
