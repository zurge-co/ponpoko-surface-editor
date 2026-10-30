export const SURFACE_BRIDGE_CHANNEL = "ponpoko.surface.v1";
export const SURFACE_READY = "ponpoko.surface.ready";
export const HOST_HELLO = "ponpoko.host.hello";
export const HOST_PALETTE = "ponpoko.host.palette";
export const HOST_DROP = "ponpoko.host.drop";

export type PaletteTokens = Record<string, string>;

export type SurfaceVerb = "tool.file" | "tool.paste" | "backend.call";

export const SURFACE_VERBS: readonly SurfaceVerb[] = ["tool.file", "tool.paste", "backend.call"];

export type PasteKind = "file" | "image" | "text" | "nothing";

export const PASTE_KINDS: readonly PasteKind[] = ["file", "image", "text", "nothing"];

export interface PasteAnswer {
  kind: PasteKind;
  name: string;
  mime: string;
  bytes: number;
  base64: string;
  paths: string[];
  text: string;
}

export const NOTHING_TO_PASTE: PasteAnswer = {
  kind: "nothing",
  name: "",
  mime: "",
  bytes: 0,
  base64: "",
  paths: [],
  text: "",
};

export function readPasteAnswer(value: unknown): PasteAnswer {
  if (!isRecord(value)) return NOTHING_TO_PASTE;
  const kind = PASTE_KINDS.find((name) => name === value.kind) ?? "nothing";
  const strings = (field: unknown): string[] =>
    Array.isArray(field) ? field.filter((entry): entry is string => typeof entry === "string") : [];
  return {
    kind,
    name: typeof value.name === "string" ? value.name : "",
    mime: typeof value.mime === "string" ? value.mime : "",
    bytes: typeof value.bytes === "number" && Number.isFinite(value.bytes) ? value.bytes : 0,
    base64: typeof value.base64 === "string" ? value.base64 : "",
    paths: strings(value.paths),
    text: typeof value.text === "string" ? value.text : "",
  };
}

export function dropPaths(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const field = value.paths;
  if (!Array.isArray(field)) return [];
  return field.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

export interface HostTransport {
  post(message: unknown): void;
  subscribe(handler: (message: unknown) => void): () => void;
}

export function parentTransport(): HostTransport {
  return {
    post: (message) => window.parent.postMessage(message, "*"),
    subscribe(handler) {
      const listener = (event: MessageEvent) => {
        if (event.source !== window.parent) return;
        handler(event.data);
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
  };
}

export function viewTokenFromLocation(url: Location | URL = window.location): string {
  return new URLSearchParams(url.search).get("view")?.trim() ?? "";
}

export interface FilePickRequest {
  mode: "open" | "save";
  title?: string;
  directory?: boolean;
  defaultPath?: string;
}

export interface SurfaceLink {
  view: string;
  call(verb: SurfaceVerb, payload?: unknown): Promise<unknown>;
  callBackend<T = unknown>(method: string, params?: unknown): Promise<T>;
  pickFile(request: FilePickRequest): Promise<string | null>;
  paste(): Promise<PasteAnswer>;
  announceReady(): void;
  onHello(handler: (doors: readonly string[]) => void): () => void;
  onPalette(handler: (tokens: PaletteTokens) => void): () => void;
  onDrop(handler: (paths: readonly string[]) => void): () => void;
}

export interface SurfaceLinkOptions {
  view: string;
  transport: HostTransport;
  newId?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createSurfaceLink(options: SurfaceLinkOptions): SurfaceLink {
  const { view, transport } = options;
  const newId = options.newId ?? defaultId;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const helloHandlers = new Set<(doors: readonly string[]) => void>();
  const paletteHandlers = new Set<(tokens: PaletteTokens) => void>();
  const dropHandlers = new Set<(paths: readonly string[]) => void>();

  transport.subscribe((message) => {
    if (!isRecord(message)) return;
    if (message.channel !== SURFACE_BRIDGE_CHANNEL || message.view !== view) return;

    if (message.control === HOST_HELLO) {
      const doors = Array.isArray(message.doors)
        ? message.doors.filter((door): door is string => typeof door === "string")
        : [];
      for (const handler of helloHandlers) handler(doors);
      return;
    }

    if (message.control === HOST_PALETTE) {
      const tokens = readPaletteTokens(message.palette);
      if (tokens) for (const handler of paletteHandlers) handler(tokens);
      return;
    }

    if (message.control === HOST_DROP) {
      const paths = dropPaths(message);
      if (paths.length > 0) for (const handler of dropHandlers) handler(paths);
      return;
    }

    const id = typeof message.id === "string" ? message.id : "";
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    if (message.ok === true) {
      waiter.resolve(message.result);
      return;
    }
    waiter.reject(
      new Error(
        typeof message.error === "string" && message.error.length > 0
          ? message.error
          : "the host refused the call and did not say why",
      ),
    );
  });

  const call = (verb: SurfaceVerb, payload?: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = newId();
      pending.set(id, { resolve, reject });
      transport.post({ channel: SURFACE_BRIDGE_CHANNEL, view, id, verb, payload });
    });

  return {
    view,
    call,
    async callBackend<T>(method: string, params?: unknown): Promise<T> {
      return (await call("backend.call", { method, params })) as T;
    },
    async pickFile(request) {
      const answer = await call("tool.file", request);
      return isRecord(answer) && typeof answer.path === "string" ? answer.path : null;
    },
    async paste() {
      return readPasteAnswer(await call("tool.paste", {}));
    },
    announceReady() {
      transport.post({ channel: SURFACE_BRIDGE_CHANNEL, view, control: SURFACE_READY });
    },
    onHello(handler) {
      helloHandlers.add(handler);
      return () => helloHandlers.delete(handler);
    },
    onPalette(handler) {
      paletteHandlers.add(handler);
      return () => paletteHandlers.delete(handler);
    },
    onDrop(handler) {
      dropHandlers.add(handler);
      return () => dropHandlers.delete(handler);
    },
  };
}

export function readPaletteTokens(payload: unknown): PaletteTokens | null {
  if (!isRecord(payload) || !isRecord(payload.tokens)) return null;
  const tokens: PaletteTokens = {};
  for (const [key, value] of Object.entries(payload.tokens)) {
    if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
      tokens[key] = value.toLowerCase();
    }
  }
  return Object.keys(tokens).length > 0 ? tokens : null;
}

function defaultId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
