import type { Cookie, Session, CookiesSetDetails } from "electron";

const retention = 7 * 24 * 3600 * 1000;
type SavedCookie = { cookie: CookiesSetDetails; until: number };

// Chromium owns persistent cookies. Only session cookies need an encrypted, bounded restart backup.
export class SessionKeeper {
  private saved = new Map<string, SavedCookie>();
  private timer?: NodeJS.Timeout;
  private pending = Promise.resolve();
  private restoring = false;
  private stopped = false;
  constructor(
    private session: Session,
    private read: () => string | undefined,
    private write: (sealed?: string) => void,
    private seal: (value: unknown) => string | undefined,
    private unseal: (sealed: string) => any,
  ) {}
  private key(c: { domain?: string; path?: string; name?: string }): string {
    return JSON.stringify([c.domain, c.path, c.name]);
  }
  private details(c: Cookie): CookiesSetDetails {
    const host = (c.domain ?? "").replace(/^\./, "");
    return {
      url: `${c.secure ? "https" : "http"}://${host}${c.path}`,
      ...(c.hostOnly ? {} : { domain: c.domain }),
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
    };
  }
  async restore(): Promise<void> {
    this.restoring = true;
    try {
      const value = this.read();
      if (value) {
        const entries = this.unseal(value);
        if (Array.isArray(entries)) {
          const existing = await this.session.cookies.get({});
          for (const entry of entries as SavedCookie[]) {
            if (
              !entry?.cookie?.url ||
              !entry.cookie.name ||
              !Number.isFinite(entry.until)
            )
              continue;
            const c = entry.cookie;
            const host = new URL(c.url).hostname;
            const domain = c.domain ?? host;
            if (!/^https?:$/.test(new URL(c.url).protocol)) continue;
            const current = existing.find(
              (current) =>
                current.name === c.name &&
                current.domain === domain &&
                current.path === c.path,
            );
            if (current) {
              if (current.session && current.value === c.value)
                this.saved.set(this.key(current), entry);
              continue;
            }
            if (entry.until <= Date.now()) continue;
            try {
              await this.session.cookies.set(c);
              this.saved.set(this.key({ ...c, domain }), entry);
            } catch {
              /* Invalid or expired individual cookies must not block other sessions. */
            }
          }
        }
      }
    } catch {
      this.write(undefined);
    } finally {
      this.restoring = false;
    }
    this.session.cookies.on("changed", this.onChange);
  }
  private onChange = (
    _event: unknown,
    cookie: Cookie,
    _cause: string,
    removed: boolean,
  ): void => {
    if (this.restoring || this.stopped) return;
    if (removed) this.saved.delete(this.key(cookie));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 400);
  };
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const save = async () => {
      const next = new Map<string, SavedCookie>();
      for (const cookie of await this.session.cookies.get({})) {
        if (!cookie.session || !cookie.domain) continue;
        const key = this.key(cookie),
          previous = this.saved.get(key);
        const until =
          previous?.cookie.value === cookie.value
            ? previous.until
            : Date.now() + retention;
        // Keep expired metadata in memory so later flushes do not renew an unchanged cookie.
        next.set(key, { cookie: this.details(cookie), until });
      }
      this.saved = next;
      const active = [...next.values()].filter(
        (entry) => entry.until > Date.now(),
      );
      this.write(active.length ? this.seal(active) : undefined);
      this.session.flushStorageData();
      await this.session.cookies.flushStore();
    };
    this.pending = this.pending.then(save, save);
    return this.pending;
  }
  async clear(): Promise<void> {
    await this.pending;
    this.saved.clear();
    this.write(undefined);
    await this.session.clearStorageData();
    await this.flush();
  }
  async close(): Promise<void> {
    this.stopped = true;
    this.session.cookies.removeListener("changed", this.onChange);
    await this.flush();
  }
}
