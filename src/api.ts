import type { SurfaceLink } from "./bridge";

export interface ReadAnswer {
  path: string;
  content: string;
  bytes: number;
  modified_ms?: number | null;
}

export interface WriteAnswer {
  path: string;
  bytes: number;
}

export interface StatAnswer {
  path: string;
  exists: boolean;
  is_file: boolean;
  is_dir: boolean;
  bytes: number;
  modified_ms?: number | null;
  parent?: string | null;
}

export interface ListEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  bytes: number;
  modified_ms?: number | null;
}

export interface ListAnswer {
  path: string;
  parent?: string | null;
  entries: ListEntry[];
}

export interface AssetAnswer {
  path: string;
  bytes: number;
  base64: string;
  mime: string;
  modified_ms?: number | null;
}

export interface CreateAnswer {
  path: string;
  exists: boolean;
  is_file: boolean;
  is_dir: boolean;
  bytes: number;
}

export interface CopyAnswer {
  from: string;
  to: string;
  is_dir: boolean;
  bytes: number;
  files: number;
}

export interface AssetWriteAnswer {
  path: string;
  bytes: number;
}

export interface RenameAnswer {
  from: string;
  to: string;
  is_dir: boolean;
}

export interface DeleteAnswer {
  path: string;
  deleted: boolean;
  recursive: boolean;
}

export interface WorkspaceFile {
  path: string;
  relative: string;
  bytes: number;
  modified_ms?: number | null;
}

export interface WorkspaceFilesAnswer {
  root: string;
  files: WorkspaceFile[];
  truncated: boolean;
}

export interface SearchMatch {
  path: string;
  relative: string;
  line: number;
  column: number;
  length: number;
  line_text: string;
}

export interface SearchAnswer {
  root: string;
  query: string;
  matches: SearchMatch[];
  files_searched: number;
  truncated: boolean;
}

export interface ReplaceAnswer {
  root: string;
  changed: Array<{ path: string; relative: string; replacements: number }>;
  failed: Array<{ path: string; relative: string; error: string }>;
  total: number;
  files_searched: number;
}

export interface SymbolAnswer {
  path: string;
  language: string;
  symbols: Array<{
    name: string;
    kind: string;
    line: number;
    column: number;
    container: string | null;
    exported: boolean;
  }>;
}

export interface DefinitionLocation {
  path: string;
  relative: string;
  name: string;
  kind: string;
  line: number;
  column: number;
  length: number;
  language: string;
  source: string;
  excerpt: string;
}

export interface DefinitionAnswer {
  path: string;
  word: string;
  language: string;
  definitions: DefinitionLocation[];
  notes: string[];
}

export interface ReferenceLocation {
  path: string;
  relative: string;
  line: number;
  column: number;
  length: number;
  line_text: string;
  kind: "definition" | "reference";
}

export interface ReferencesAnswer {
  root: string;
  path: string;
  word: string;
  language: string;
  references: ReferenceLocation[];
  files_searched: number;
  truncated: boolean;
  notes: string[];
}

export interface NavigationQuery {
  path: string;
  text?: string;
  root?: string | null;
  line?: number;
  column?: number;
  word?: string;
}

export interface FormatAnswer {
  content: string;
  warnings?: string;
  edition?: string;
}

export interface AppInfo {
  pid: number;
  version: string;
  os: string;
  arch: string;
  home: string;
  separator: string;
}

export interface SearchOptions {
  root: string;
  query: string;
  regex?: boolean;
  case_sensitive?: boolean;
  whole_word?: boolean;
  include_hidden?: boolean;
  max_results?: number;
}

export interface EditorApi {
  read(path: string): Promise<ReadAnswer>;
  write(path: string, content: string): Promise<WriteAnswer>;
  stat(path: string): Promise<StatAnswer>;
  list(path: string, options?: { showHidden?: boolean }): Promise<ListAnswer>;
  readAsset(path: string): Promise<AssetAnswer>;
  create(path: string, kind: "file" | "directory", content?: string): Promise<CreateAnswer>;
  copy(from: string, to: string): Promise<CopyAnswer>;
  writeAsset(path: string, base64: string): Promise<AssetWriteAnswer>;
  rename(path: string, to: string): Promise<RenameAnswer>;
  remove(path: string, options?: { recursive?: boolean }): Promise<DeleteAnswer>;
  reveal(path: string): Promise<{ revealed: boolean; opener: string; path: string }>;
  files(root: string, options?: { includeHidden?: boolean }): Promise<WorkspaceFilesAnswer>;
  search(options: SearchOptions): Promise<SearchAnswer>;
  replace(options: SearchOptions & { replacement: string }): Promise<ReplaceAnswer>;
  symbols(path: string, text?: string): Promise<SymbolAnswer>;
  definition(query: NavigationQuery): Promise<DefinitionAnswer>;
  references(query: NavigationQuery): Promise<ReferencesAnswer>;
  formatRust(content: string, path?: string): Promise<FormatAnswer>;
  formatToml(content: string): Promise<FormatAnswer>;
  info(): Promise<AppInfo>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function navigationParams(query: NavigationQuery): Record<string, unknown> {
  return {
    path: query.path,
    ...(query.text === undefined ? {} : { text: query.text }),
    ...(query.root === undefined || query.root === null || query.root.length === 0 ? {} : { root: query.root }),
    ...(query.line === undefined ? {} : { line: query.line }),
    ...(query.column === undefined ? {} : { column: query.column }),
    ...(query.word === undefined ? {} : { word: query.word }),
  };
}

function expect<T>(value: unknown, method: string, isValid: (value: Record<string, unknown>) => boolean): T {
  if (!isRecord(value) || !isValid(value)) {
    throw new Error(`the editor's backend answered ${method} with something this surface does not understand`);
  }
  return value as T;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

export function createApi(link: SurfaceLink): EditorApi {
  const call = <T>(method: string, params: unknown, isValid: (value: Record<string, unknown>) => boolean): Promise<T> =>
    link.callBackend<unknown>(method, params).then((answer) => expect<T>(answer, method, isValid));

  return {
    read: (path) =>
      call<ReadAnswer>("fs.read", { path }, (answer) => isString(answer.content) && isNumber(answer.bytes)),
    write: (path, content) =>
      call<WriteAnswer>("fs.write", { path, content }, (answer) => isNumber(answer.bytes)),
    stat: (path) =>
      call<StatAnswer>("fs.stat", { path }, (answer) => typeof answer.exists === "boolean" && isNumber(answer.bytes)),
    list: (path, options) =>
      call<ListAnswer>(
        "fs.list",
        { path, show_hidden: options?.showHidden === true },
        (answer) => isArray(answer.entries),
      ),
    readAsset: (path) =>
      call<AssetAnswer>(
        "fs.read_asset",
        { path },
        (answer) => isString(answer.base64) && isString(answer.mime) && isNumber(answer.bytes),
      ),
    create: (path, kind, content) =>
      call<CreateAnswer>(
        "fs.create",
        content === undefined ? { path, kind } : { path, kind, content },
        (answer) => typeof answer.exists === "boolean" && isNumber(answer.bytes),
      ),
    copy: (from, to) =>
      call<CopyAnswer>(
        "fs.copy",
        { from, to },
        (answer) => isString(answer.from) && isString(answer.to) && isNumber(answer.bytes),
      ),
    writeAsset: (path, base64) =>
      call<AssetWriteAnswer>(
        "fs.write_asset",
        { path, base64 },
        (answer) => isString(answer.path) && isNumber(answer.bytes),
      ),
    rename: (path, to) =>
      call<RenameAnswer>("fs.rename", { path, to }, (answer) => isString(answer.to)),
    remove: (path, options) =>
      call<DeleteAnswer>(
        "fs.delete",
        { path, recursive: options?.recursive === true },
        (answer) => answer.deleted === true,
      ),
    reveal: (path) =>
      call<{ revealed: boolean; opener: string; path: string }>(
        "fs.reveal",
        { path },
        (answer) => typeof answer.revealed === "boolean",
      ),
    files: (root, options) =>
      call<WorkspaceFilesAnswer>(
        "workspace.files",
        { root, include_hidden: options?.includeHidden === true },
        (answer) => isArray(answer.files),
      ),
    search: (options) =>
      call<SearchAnswer>(
        "workspace.search",
        {
          root: options.root,
          query: options.query,
          regex: options.regex === true,
          case_sensitive: options.case_sensitive === true,
          whole_word: options.whole_word === true,
          include_hidden: options.include_hidden === true,
          ...(options.max_results === undefined ? {} : { max_results: options.max_results }),
        },
        (answer) => isArray(answer.matches),
      ),
    replace: (options) =>
      call<ReplaceAnswer>(
        "workspace.replace",
        {
          root: options.root,
          query: options.query,
          replacement: options.replacement,
          regex: options.regex === true,
          case_sensitive: options.case_sensitive === true,
          whole_word: options.whole_word === true,
          include_hidden: options.include_hidden === true,
        },
        (answer) => isArray(answer.changed) && isArray(answer.failed) && isNumber(answer.total),
      ),
    symbols: (path, text) =>
      call<SymbolAnswer>(
        "workspace.symbols",
        text === undefined ? { path } : { path, text },
        (answer) => isArray(answer.symbols),
      ),
    definition: (query) =>
      call<DefinitionAnswer>(
        "workspace.definition",
        navigationParams(query),
        (answer) => isArray(answer.definitions) && isString(answer.word) && isArray(answer.notes),
      ),
    references: (query) =>
      call<ReferencesAnswer>(
        "workspace.references",
        navigationParams(query),
        (answer) =>
          isArray(answer.references) && isNumber(answer.files_searched) && isArray(answer.notes),
      ),
    formatRust: (content, path) =>
      call<FormatAnswer>(
        "fmt.rustfmt",
        path === undefined ? { content } : { content, path },
        (answer) => isString(answer.content),
      ),
    formatToml: (content) =>
      call<FormatAnswer>("fmt.toml", { content }, (answer) => isString(answer.content)),
    info: () =>
      call<AppInfo>("app.info", {}, (answer) => isString(answer.home) && isString(answer.separator)),  };
}
