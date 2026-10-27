export type UnsavedChoice = "save" | "discard" | "cancel";

export type ConflictChoice = "overwrite" | "reload" | "keep" | "cancel";

export type ConflictKind = "save" | "reload";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: string;
  label: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  validate?(value: string): string | null;
}

export interface DialogHost {
  readonly element: HTMLElement;
  askUnsaved(name: string): Promise<UnsavedChoice>;
  askConflict(kind: ConflictKind, name: string): Promise<ConflictChoice>;
  confirm(options: ConfirmOptions): Promise<boolean>;
  prompt(options: PromptOptions): Promise<string | null>;
  isOpen(): boolean;
  close(): void;
}

interface Action {
  label: string;
  value: unknown;
  primary?: boolean;
  danger?: boolean;
}

export function createDialogHost(parent: HTMLElement = document.body): DialogHost {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.hidden = true;

  const panel = document.createElement("div");
  panel.className = "modal";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  backdrop.append(panel);
  parent.append(backdrop);

  let open = false;
  let restoreFocus: HTMLElement | null = null;
  let resolveCurrent: ((value: unknown) => void) | null = null;
  let cancelValue: unknown = "cancel";
  let buttons: HTMLButtonElement[] = [];
  let chain: Promise<unknown> = Promise.resolve();

  const finish = (value: unknown) => {
    if (!open) return;
    const resolve = resolveCurrent;
    resolveCurrent = null;
    open = false;
    backdrop.hidden = true;
    buttons = [];
    panel.replaceChildren();
    if (restoreFocus !== null && restoreFocus.isConnected) restoreFocus.focus();
    restoreFocus = null;
    resolve?.(value);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(cancelValue);
      return;
    }
    if (event.key !== "Tab" || buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  window.addEventListener("keydown", onKeyDown, true);

  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) finish(cancelValue);
  });

  function present(title: string, message: string, actions: Action[]): Promise<unknown> {
    return new Promise((resolve) => {
      const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      restoreFocus = current;
      open = true;
      backdrop.hidden = false;
      cancelValue = actions.find((action) => action.value === "cancel")?.value ?? false;

      const heading = document.createElement("h2");
      heading.className = "modal-title";
      heading.id = "ponpoko-editor-modal-title";
      heading.textContent = title;
      const body = document.createElement("p");
      body.className = "modal-message";
      body.id = "ponpoko-editor-modal-message";
      body.textContent = message;
      const row = document.createElement("div");
      row.className = "modal-actions";

      buttons = actions.map((action) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action.label;
        button.className = `modal-button${action.primary ? " primary" : ""}${action.danger ? " danger" : ""}`;
        button.addEventListener("click", () => finish(action.value));
        row.append(button);
        return button;
      });

      panel.setAttribute("aria-labelledby", heading.id);
      panel.setAttribute("aria-describedby", body.id);
      panel.replaceChildren(heading, body, row);
      const primaryIndex = actions.findIndex((action) => action.primary);
      (buttons[primaryIndex >= 0 ? primaryIndex : 0] ?? buttons[0])?.focus();
      resolveCurrent = resolve;
    });
  }

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = chain.then(job, job) as Promise<T>;
    chain = run.catch(() => undefined);
    return run;
  }

  async function conflictFlow(kind: ConflictKind, name: string): Promise<ConflictChoice> {
    const title = `${name} changed on disk`;
    const raw =
      kind === "save"
        ? await present(
            title,
            `Another program wrote ${name} after this tab read it. Saving now replaces those changes with the text in this tab; reloading replaces the tab with what is on disk.`,
            [
              { label: "Overwrite", value: "overwrite", danger: true },
              { label: "Reload from Disk", value: "reload", primary: true },
              { label: "Cancel", value: "cancel" },
            ],
          )
        : await present(
            title,
            `Another program wrote ${name} after this tab read it, and this tab has unsaved edits. Reloading discards them; keeping them means the next save will ask before it overwrites the file.`,
            [
              { label: "Keep My Version", value: "keep", primary: true },
              { label: "Reload from Disk", value: "reload", danger: true },
              { label: "Decide Later", value: "cancel" },
            ],
          );
    if (raw === "overwrite" || raw === "reload" || raw === "keep") return raw;
    return "cancel";
  }

  function presentPrompt(options: PromptOptions): Promise<string | null> {
    return new Promise((resolve) => {
      const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      restoreFocus = current;
      open = true;
      backdrop.hidden = false;
      cancelValue = null;

      const heading = document.createElement("h2");
      heading.className = "modal-title";
      heading.id = "ponpoko-editor-modal-title";
      heading.textContent = options.title;

      const parts: HTMLElement[] = [heading];
      if (options.message !== undefined) {
        const body = document.createElement("p");
        body.className = "modal-message";
        body.textContent = options.message;
        parts.push(body);
      }

      const field = document.createElement("label");
      field.className = "modal-field";
      const labelText = document.createElement("span");
      labelText.className = "modal-label";
      labelText.textContent = options.label;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "modal-input";
      input.value = options.value ?? "";
      input.autocomplete = "off";
      input.spellcheck = false;
      if (options.placeholder !== undefined) input.placeholder = options.placeholder;
      field.append(labelText, input);
      parts.push(field);

      const problem = document.createElement("p");
      problem.className = "modal-error";
      problem.hidden = true;
      problem.setAttribute("role", "alert");
      parts.push(problem);

      const row = document.createElement("div");
      row.className = "modal-actions";
      const submit = () => {
        const value = input.value.trim();
        const complaint = value.length === 0 ? "A name is required." : (options.validate?.(value) ?? null);
        if (complaint !== null) {
          problem.textContent = complaint;
          problem.hidden = false;
          input.focus();
          return;
        }
        finish(value);
      };

      const confirmButton = document.createElement("button");
      confirmButton.type = "button";
      confirmButton.className = "modal-button primary";
      confirmButton.textContent = options.confirmLabel ?? "OK";
      confirmButton.addEventListener("click", submit);

      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "modal-button";
      cancelButton.textContent = "Cancel";
      cancelButton.addEventListener("click", () => finish(null));

      row.append(cancelButton, confirmButton);
      parts.push(row);
      buttons = [confirmButton, cancelButton];

      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        }
      });
      input.addEventListener("input", () => {
        problem.hidden = true;
      });

      panel.setAttribute("aria-labelledby", heading.id);
      panel.replaceChildren(...parts);
      input.focus();
      const dot = input.value.lastIndexOf(".");
      if (dot > 0) input.setSelectionRange(0, dot);
      else input.select();

      resolveCurrent = (value) => resolve(typeof value === "string" ? value : null);
    });
  }

  return {
    element: backdrop,
    askUnsaved(name) {
      return enqueue(
        () =>
          present(
            `Save changes to ${name}?`,
            `Your edits to ${name} have not been saved. If you close it without saving, they will be lost; the file on disk stays as it was.`,
            [
              { label: "Save", value: "save", primary: true },
              { label: "Don't Save", value: "discard", danger: true },
              { label: "Cancel", value: "cancel" },
            ],
          ) as Promise<UnsavedChoice>,
      );
    },
    confirm(options) {
      return enqueue(async () => {
        const choice = await present(options.title, options.message, [
          { label: options.confirmLabel, value: "confirm", primary: !options.danger, danger: options.danger },
          { label: options.cancelLabel ?? "Cancel", value: "cancel" },
        ]);
        return choice === "confirm";
      });
    },
    askConflict(kind, name) {
      return enqueue(() => conflictFlow(kind, name));
    },
    prompt(options) {
      return enqueue(() => presentPrompt(options));
    },
    isOpen: () => open,
    close: () => finish(cancelValue),
  };
}
