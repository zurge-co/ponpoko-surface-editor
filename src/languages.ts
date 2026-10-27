import { StreamLanguage, type LanguageSupport } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { less } from "@codemirror/lang-less";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sass } from "@codemirror/lang-sass";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import type { Extension } from "@codemirror/state";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";

import { baseName } from "./files";

export type LanguageId =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "rust"
  | "yaml"
  | "json"
  | "jsonc"
  | "markdown"
  | "mdx"
  | "toml"
  | "html"
  | "xml"
  | "css"
  | "scss"
  | "less"
  | "python"
  | "go"
  | "c"
  | "cpp"
  | "java"
  | "php"
  | "sql"
  | "shell"
  | "dockerfile"
  | "properties"
  | "diff"
  | "text";

export interface CommentTokens {
  line?: string;
  block?: { open: string; close: string };
}

export interface LanguageDefinition {
  id: LanguageId;
  label: string;
  extensions: readonly string[];
  filenames?: readonly string[];
  commentTokens?: CommentTokens;
  create(): Extension;
}

function streamLanguage(
  mode: Parameters<typeof StreamLanguage.define>[0],
  commentTokens: CommentTokens,
): Extension {
  const language = StreamLanguage.define(mode);
  return [language, language.data.of({ commentTokens })];
}

function support(language: LanguageSupport): Extension {
  return language;
}

const DOCKERFILE: LanguageDefinition = {
  id: "dockerfile",
  label: "Dockerfile",
  extensions: [],
  filenames: ["dockerfile", "containerfile"],
  commentTokens: { line: "#" },
  create: () => streamLanguage(dockerFile, { line: "#" }),
};

export const LANGUAGES: readonly LanguageDefinition[] = [
  {
    id: "typescript",
    label: "TypeScript",
    extensions: ["ts", "mts", "cts"],
    create: () => support(javascript({ typescript: true })),
  },
  {
    id: "tsx",
    label: "TypeScript JSX",
    extensions: ["tsx"],
    create: () => support(javascript({ typescript: true, jsx: true })),
  },
  {
    id: "javascript",
    label: "JavaScript",
    extensions: ["js", "mjs", "cjs"],
    create: () => support(javascript()),
  },
  {
    id: "jsx",
    label: "JavaScript JSX",
    extensions: ["jsx"],
    create: () => support(javascript({ jsx: true })),
  },
  {
    id: "rust",
    label: "Rust",
    extensions: ["rs"],
    create: () => support(rust()),
  },
  {
    id: "yaml",
    label: "YAML",
    extensions: ["yml", "yaml"],
    create: () => support(yaml()),
  },
  {
    id: "json",
    label: "JSON",
    extensions: ["json", "map"],
    filenames: ["package-lock.json", "composer.json"],
    create: () => support(json()),
  },
  {
    id: "jsonc",
    label: "JSON with comments",
    extensions: ["jsonc", "json5"],
    filenames: ["tsconfig.json", "tsconfig.base.json", "jsconfig.json", ".eslintrc.json"],
    create: () => support(json()),
  },
  {
    id: "markdown",
    label: "Markdown",
    extensions: ["md", "markdown", "mdown", "mkd"],
    create: () => support(markdown()),
  },
  {
    id: "mdx",
    label: "MDX",
    extensions: ["mdx"],
    create: () => support(markdown()),
  },
  {
    id: "toml",
    label: "TOML",
    extensions: ["toml"],
    filenames: ["cargo.lock"],
    commentTokens: { line: "#" },
    create: () => streamLanguage(toml, { line: "#" }),
  },
  {
    id: "html",
    label: "HTML",
    extensions: ["html", "htm"],
    create: () => support(html()),
  },
  {
    id: "xml",
    label: "XML",
    extensions: ["xml", "svg", "xhtml", "xsd", "xsl", "plist", "csproj", "rss", "atom"],
    create: () => support(xml()),
  },
  {
    id: "css",
    label: "CSS",
    extensions: ["css"],
    create: () => support(css()),
  },
  {
    id: "scss",
    label: "SCSS",
    extensions: ["scss"],
    create: () => support(sass({ indented: false })),
  },
  {
    id: "less",
    label: "Less",
    extensions: ["less"],
    create: () => support(less()),
  },
  {
    id: "python",
    label: "Python",
    extensions: ["py", "pyi", "pyw"],
    create: () => support(python()),
  },
  {
    id: "go",
    label: "Go",
    extensions: ["go"],
    create: () => support(go()),
  },
  {
    id: "c",
    label: "C",
    extensions: ["c", "h"],
    create: () => support(cpp()),
  },
  {
    id: "cpp",
    label: "C++",
    extensions: ["cpp", "cxx", "cc", "hpp", "hxx", "hh", "ino"],
    create: () => support(cpp()),
  },
  {
    id: "java",
    label: "Java",
    extensions: ["java"],
    create: () => support(java()),
  },
  {
    id: "php",
    label: "PHP",
    extensions: ["php", "phtml"],
    create: () => support(php()),
  },
  {
    id: "sql",
    label: "SQL",
    extensions: ["sql"],
    create: () => support(sql()),
  },
  {
    id: "shell",
    label: "Shell",
    extensions: ["sh", "bash", "zsh", "ksh"],
    filenames: ["makefile", "gnumakefile", "justfile", "rakefile", "brewfile"],
    commentTokens: { line: "#" },
    create: () => streamLanguage(shell, { line: "#" }),
  },
  DOCKERFILE,
  {
    id: "properties",
    label: "INI / properties",
    extensions: ["ini", "cfg", "conf", "properties", "env"],
    filenames: [".editorconfig", ".env", ".gitconfig", ".npmrc"],
    commentTokens: { line: "#" },
    create: () => streamLanguage(properties, { line: "#" }),
  },
  {
    id: "diff",
    label: "Diff",
    extensions: ["diff", "patch"],
    create: () => streamLanguage(diff, { line: "diff" }),
  },
  {
    id: "text",
    label: "Plain text",
    extensions: [],
    create: () => [],
  },
];

const BY_ID = new Map<LanguageId, LanguageDefinition>(LANGUAGES.map((entry) => [entry.id, entry]));

const BY_EXTENSION = new Map<string, LanguageDefinition>();
const BY_FILENAME = new Map<string, LanguageDefinition>();
for (const definition of LANGUAGES) {
  for (const extension of definition.extensions) BY_EXTENSION.set(extension, definition);
  for (const filename of definition.filenames ?? []) BY_FILENAME.set(filename.toLowerCase(), definition);
}

function dockerfileByName(name: string): boolean {
  return name === "dockerfile" || name.startsWith("dockerfile.") || name.startsWith("containerfile.");
}

export function languageFor(path: string): LanguageId {
  const name = baseName(path);
  const lower = name.toLowerCase();
  const byName = BY_FILENAME.get(lower);
  if (byName) return byName.id;
  if (dockerfileByName(lower)) return DOCKERFILE.id;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "text";
  const extension = name.slice(dot + 1).toLowerCase();
  return BY_EXTENSION.get(extension)?.id ?? "text";
}

export function languageById(id: string): LanguageDefinition | undefined {
  return BY_ID.get(id as LanguageId);
}

export function isLanguageId(id: string): id is LanguageId {
  return BY_ID.has(id as LanguageId);
}

export function languageLabel(id: LanguageId): string {
  return BY_ID.get(id)?.label ?? "Plain text";
}

export function languageExtension(id: LanguageId): Extension {
  const definition = BY_ID.get(id) ?? BY_ID.get("text");
  return definition ? definition.create() : [];
}

export function languageChoices(): Array<{ id: LanguageId; label: string }> {
  return LANGUAGES.map((definition) => ({ id: definition.id, label: definition.label }));
}

export function commentTokensFor(id: LanguageId): CommentTokens | undefined {
  return BY_ID.get(id)?.commentTokens;
}
