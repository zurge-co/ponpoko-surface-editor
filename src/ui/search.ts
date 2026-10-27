import type { ReplaceAnswer, SearchAnswer, SearchMatch, SearchOptions } from "../api";
import { createIcon } from "./icons";

export interface SearchState {
  query: string;
  replacement: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  includeHidden: boolean;
}

export const DEFAULT_SEARCH: SearchState = {
  query: "",
  replacement: "",
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  includeHidden: false,
};

export function searchOptions(root: string, state: SearchState): SearchOptions {
  return {
    root,
    query: state.query,
    regex: state.regex,
    case_sensitive: state.caseSensitive,
    whole_word: state.wholeWord,
    include_hidden: state.includeHidden,
  };
}

export interface SearchFileGroup {
  path: string;
  relative: string;
  matches: SearchMatch[];
}

export function groupMatches(matches: readonly SearchMatch[]): SearchFileGroup[] {
  const groups = new Map<string, SearchFileGroup>();
  for (const match of matches) {
    const group = groups.get(match.path);
    if (group === undefined) {
      groups.set(match.path, { path: match.path, relative: match.relative, matches: [match] });
    } else {
      group.matches.push(match);
    }
  }
  return [...groups.values()].sort((a, b) =>
    a.relative.localeCompare(b.relative, undefined, { numeric: true, sensitivity: "base" }),
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function searchSummary(answer: SearchAnswer): string {
  if (answer.matches.length === 0) {
    return `No matches for “${answer.query}” in ${plural(answer.files_searched, "file", "files")}.`;
  }
  const files = new Set(answer.matches.map((match) => match.path)).size;
  const base = `${plural(answer.matches.length, "match", "matches")} in ${plural(files, "file", "files")}`;
  return answer.truncated
    ? `${base} — stopped at the result limit; narrow the search to see the rest.`
    : `${base} · ${answer.files_searched} searched`;
}

export function replacementSummary(answer: ReplaceAnswer): string {
  const files = answer.changed.length;
  if (answer.total === 0) {
    const failed =
      answer.failed.length > 0
        ? ` ${plural(answer.failed.length, "file", "files")} could not be written: ${answer.failed
            .slice(0, 3)
            .map((entry) => `${entry.relative} (${entry.error})`)
            .join(", ")}.`
        : "";
    return `Nothing was replaced.${failed}`;
  }
  const base = `Replaced ${plural(answer.total, "place", "places")} in ${plural(files, "file", "files")}`;
  return answer.failed.length === 0
    ? `${base}.`
    : `${base}; ${plural(answer.failed.length, "file", "files")} could not be written (${answer.failed
        .slice(0, 3)
        .map((entry) => entry.relative)
        .join(", ")}).`;
}

export function replaceConfirmMessage(state: SearchState, answer: SearchAnswer): string {
  const files = new Set(answer.matches.map((match) => match.path)).size;
  const count = answer.truncated ? "at least " + answer.matches.length : `${answer.matches.length}`;
  const query = state.query;
  const replacement = state.replacement.length === 0 ? "an empty string" : `“${state.replacement}”`;
  const noun = answer.matches.length === 1 && !answer.truncated ? "match" : "matches";
  return `Replace ${count} ${noun} of “${query}” with ${replacement} in ${plural(files, "file", "files")}? This writes to the files on disk and cannot be undone from this editor.`;
}

export interface SearchDeps {
  workspace(): string | null;
  search(options: SearchOptions): Promise<SearchAnswer>;
  replace(options: SearchOptions & { replacement: string }): Promise<ReplaceAnswer>;
  openMatch(match: SearchMatch): void;
  confirm(options: { title: string; message: string; confirmLabel: string; danger: boolean }): Promise<boolean>;
  onReplaced(changed: readonly string[]): void;
  onError(message: string): void;
  onNote(message: string): void;
}

export interface SearchPanel {
  readonly element: HTMLElement;
  focus(): void;
  setQuery(query: string): void;
  run(): Promise<void>;
  destroy(): void;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function markedLine(match: SearchMatch): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const text = match.line_text;
  const start = Math.min(text.length, Math.max(0, match.column));
  const length = Math.max(0, Math.min(match.length, text.length - start));
  if (length === 0) {
    fragment.append(document.createTextNode(text));
    return fragment;
  }
  fragment.append(document.createTextNode(text.slice(0, start)));
  const mark = document.createElement("mark");
  mark.textContent = text.slice(start, start + length);
  fragment.append(mark);
  fragment.append(document.createTextNode(text.slice(start + length)));
  return fragment;
}

export function createSearchPanel(deps: SearchDeps): SearchPanel {
  const root = element("div", "search-panel");

  const field = element("div", "search-field");
  const query = element("input", "search-input");
  query.type = "search";
  query.placeholder = "Search this folder";
  query.autocomplete = "off";
  query.spellcheck = false;
  query.setAttribute("aria-label", "Search in files");

  const toggles = element("div", "search-options");
  const option = (label: string, title: string): HTMLButtonElement => {
    const button = element("button", "search-option");
    button.type = "button";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.setAttribute("aria-pressed", "false");
    toggles.append(button);
    return button;
  };
  const caseButton = option("Aa", "Match case");
  const wordButton = option("W", "Match whole word");
  const regexButton = option(".*", "Use a regular expression");
  const hiddenButton = option("•", "Include hidden files and folders");
  field.append(query, toggles);

  const replaceRow = element("div", "search-replace-row");
  const replacement = element("input", "search-input search-replacement");
  replacement.type = "text";
  replacement.placeholder = "Replace with";
  replacement.autocomplete = "off";
  replacement.spellcheck = false;
  replacement.setAttribute("aria-label", "Replace with");
  const replaceAll = element("button", "search-replace-all");
  replaceAll.type = "button";
  replaceAll.textContent = "Replace All";
  replaceAll.disabled = true;
  replaceRow.append(replacement, replaceAll);

  const status = element("p", "search-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = "Open a folder, then type what to look for.";

  const results = element("div", "search-results");
  results.setAttribute("aria-label", "Search results");

  root.append(field, replaceRow, status, results);

  let answer: SearchAnswer | null = null;
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let replacing = false;

  const state = (): SearchState => ({
    query: query.value,
    replacement: replacement.value,
    regex: regexButton.getAttribute("aria-pressed") === "true",
    caseSensitive: caseButton.getAttribute("aria-pressed") === "true",
    wholeWord: wordButton.getAttribute("aria-pressed") === "true",
    includeHidden: hiddenButton.getAttribute("aria-pressed") === "true",
  });

  function clearResults(): void {
    answer = null;
    results.replaceChildren();
    replaceAll.disabled = true;
  }

  function renderGroups(found: SearchAnswer): void {
    results.replaceChildren();
    const groups = groupMatches(found.matches);
    if (groups.length === 0) return;
    for (const group of groups) {
      const block = element("div", "search-file");
      const heading = element("div", "search-file-header");
      heading.append(createIcon("file-text", 12));
      const name = element("span", "search-file-name");
      name.textContent = group.relative;
      name.title = group.path;
      const count = element("span", "search-file-count");
      count.textContent = String(group.matches.length);
      heading.append(name, count);
      block.append(heading);

      for (const match of group.matches) {
        const row = element("button", "search-match");
        row.type = "button";
        row.title = `${group.relative}:${match.line}:${match.column + 1}`;
        const where = element("span", "search-match-line");
        where.textContent = `${match.line}`;
        const text = element("span", "search-match-text");
        text.append(markedLine(match));
        row.append(where, text);
        row.addEventListener("click", () => deps.openMatch(match));
        block.append(row);
      }
      results.append(block);
    }
  }

  async function run(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const current = state();
    const rootPath = deps.workspace();
    const token = (sequence += 1);
    if (rootPath === null) {
      clearResults();
      status.textContent = "Open a folder to search in it.";
      return;
    }
    if (current.query.trim().length === 0) {
      clearResults();
      status.textContent = "Type what to look for.";
      return;
    }
    status.textContent = "Searching…";
    try {
      const found = await deps.search(searchOptions(rootPath, current));
      if (token !== sequence) return;
      answer = found;
      status.textContent = searchSummary(found);
      renderGroups(found);
      replaceAll.disabled = found.matches.length === 0;
    } catch (error) {
      if (token !== sequence) return;
      clearResults();
      const message = `The search could not run: ${messageOf(error)}`;
      status.textContent = message;
      deps.onError(message);
    }
  }

  function scheduleRun(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, 250);
  }

  const toggle = (button: HTMLButtonElement, rerun: boolean): void => {
    button.setAttribute("aria-pressed", button.getAttribute("aria-pressed") === "true" ? "false" : "true");
    if (rerun) void run();
  };
  for (const button of [caseButton, wordButton, regexButton, hiddenButton]) {
    button.addEventListener("click", () => toggle(button, true));
  }

  async function replaceAllNow(): Promise<void> {
    if (replacing) return;
    replacing = true;
    try {
      await replaceAllWithConfirm();
    } finally {
      replacing = false;
    }
  }

  async function replaceAllWithConfirm(): Promise<void> {
    const current = state();
    const rootPath = deps.workspace();
    if (rootPath === null) {
      deps.onNote("open a folder before replacing in it");
      return;
    }
    if (current.query.trim().length === 0) {
      deps.onNote("type what to replace first");
      return;
    }
    if (answer === null || answer.query !== current.query) await run();
    const found = answer;
    if (found === null || found.matches.length === 0) {
      deps.onNote(`nothing to replace: no match for “${current.query}”`);
      return;
    }
    const confirmed = await deps.confirm({
      title: "Replace all matches?",
      message: replaceConfirmMessage(current, found),
      confirmLabel: "Replace All",
      danger: true,
    });
    if (!confirmed) {
      deps.onNote("nothing was replaced");
      return;
    }
    try {
      const result = await deps.replace({
        ...searchOptions(rootPath, current),
        replacement: current.replacement,
      });
      const summary = replacementSummary(result);
      deps.onNote(summary);
      status.textContent = summary;
      if (result.failed.length > 0) {
        deps.onError(
          `Replace All could not write ${plural(result.failed.length, "file", "files")}: ${result.failed
            .slice(0, 3)
            .map((entry) => `${entry.relative} (${entry.error})`)
            .join(", ")}. The other files were changed.`,
        );
      }
      deps.onReplaced(result.changed.map((entry) => entry.path));
      await run();
    } catch (error) {
      const message = `Replace All could not run: ${messageOf(error)}`;
      status.textContent = message;
      deps.onError(message);
    }
  }

  query.addEventListener("input", scheduleRun);
  query.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void run();
  });
  replacement.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void replaceAllNow();
  });
  replaceAll.addEventListener("click", () => void replaceAllNow());

  return {
    element: root,
    focus: () => {
      query.focus();
      query.select();
    },
    setQuery(next) {
      query.value = next;
      void run();
    },
    run,
    destroy() {
      if (timer !== null) clearTimeout(timer);
      sequence += 1;
      root.remove();
    },
  };
}
