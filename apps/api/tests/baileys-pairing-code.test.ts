import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BaileysWhatsAppProvider, type WhatsAppStatusSnapshot } from "@whatsatendende/whatsapp";

/**
 * "Conectar com número": WhatsApp hands out the code and, right after, closes the socket ("restart required");
 * the provider reconnects. The code must stay on screen through all of that, and be swapped straight for the
 * next one when it expires — it used to flash and vanish. A fake socket stands in for WhatsApp's servers.
 */

const RESTART_REQUIRED = 515;
const CONNECTION_LOST = 408;

interface FakeSocket {
  ev: EventEmitter;
  user: undefined;
  waitForSocketOpen: () => Promise<void>;
  requestPairingCode: (phone: string) => Promise<string>;
  end: () => void;
  logout: () => Promise<void>;
}

function setup(codes: string[]) {
  const sockets: FakeSocket[] = [];
  const requests: string[] = [];
  const socketFactory = ((config: { auth: { creds: { pairingCode?: string } } }) => {
    const socket: FakeSocket = {
      ev: new EventEmitter(),
      user: undefined,
      waitForSocketOpen: async () => undefined,
      // Like Baileys: the code is kept in the session's credentials.
      requestPairingCode: async (phone: string) => {
        requests.push(phone);
        const code = codes.shift() ?? "ZZZZ9999";
        config.auth.creds.pairingCode = code;
        socket.ev.emit("creds.update", { pairingCode: code });
        return code;
      },
      end: () => undefined,
      logout: async () => undefined,
    };
    sockets.push(socket);
    return socket;
  }) as never;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pairing-"));
  const provider = new BaileysWhatsAppProvider({ authStateDir: path.join(dir, "auth"), socketFactory });
  const history: WhatsAppStatusSnapshot[] = [];
  provider.onConnectionUpdate((s) => history.push(s));
  const close = (statusCode: number) => sockets.at(-1)!.ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode } } } });
  return { provider, sockets, requests, history, close, dir };
}

// Real file I/O (the session credentials) runs between fake timers — give it room to finish.
async function settle() {
  for (let i = 0; i < 200; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe("código de conexão pelo número: fica na tela até o próximo", () => {
  beforeEach(() => {
    process.env.WHATSAPP_PAIRING_LOG_LEVEL = "silent";
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("o WhatsApp derruba a conexão logo depois do código: o código continua na tela, o mesmo", async () => {
    const { provider, history, close, requests } = setup(["ABCD1234"]);
    await provider.connect({ phoneNumber: "+55 65 98888-7777" });
    await settle();
    expect(provider.getStatus()).toMatchObject({ state: "CODE_PENDING", pairingCode: "ABCD-1234", pairingPhoneNumber: "5565988887777" });
    expect(provider.getStatus().pairingCodeExpiresAt).toBeInstanceOf(Date);
    const shownAt = history.length;

    close(RESTART_REQUIRED);
    await vi.advanceTimersByTimeAsync(3000); // the automatic reconnect
    await settle();

    expect(provider.getStatus()).toMatchObject({ state: "CODE_PENDING", pairingCode: "ABCD-1234" });
    // Not one status in between without the code — that was the flash.
    expect(history.slice(shownAt).every((s) => s.pairingCode === "ABCD-1234")).toBe(true);
    expect(requests).toHaveLength(1); // the same code, not a new request
  });

  it("outras quedas que o WhatsApp ainda recupera também não apagam o código", async () => {
    const { provider, history, close } = setup(["ABCD1234"]);
    await provider.connect({ phoneNumber: "5565988887777" });
    await settle();
    const shownAt = history.length;
    close(CONNECTION_LOST);
    await vi.advanceTimersByTimeAsync(3000);
    await settle();
    expect(provider.getStatus().pairingCode).toBe("ABCD-1234");
    expect(history.slice(shownAt).every((s) => s.pairingCode !== null)).toBe(true);
  });

  it("quando o código vence, o próximo entra direto no lugar — sem passar por tela vazia", async () => {
    const { provider, history } = setup(["ABCD1234", "EFGH5678"]);
    await provider.connect({ phoneNumber: "5565988887777" });
    await settle();
    const shownAt = history.length;

    await vi.advanceTimersByTimeAsync(59_000);
    expect(provider.getStatus().pairingCode).toBe("ABCD-1234");
    await vi.advanceTimersByTimeAsync(1_500);
    await settle();

    expect(provider.getStatus()).toMatchObject({ state: "CODE_PENDING", pairingCode: "EFGH-5678" });
    expect(history.slice(shownAt).map((s) => s.pairingCode)).not.toContain(null);
  });

  it("se o WhatsApp encerra de vez (tentativas esgotadas), aí sim o código sai", async () => {
    const { provider, close } = setup(["ABCD1234"]);
    await provider.connect({ phoneNumber: "5565988887777" });
    await settle();
    // Closed again and again within the same code's lifetime (each retry waits longer: 3 s, 6 s, 12 s).
    for (const wait of [3000, 6000, 12_000, 1000]) {
      close(CONNECTION_LOST);
      await vi.advanceTimersByTimeAsync(wait);
      await settle();
    }
    expect(provider.getStatus()).toMatchObject({ state: "DISCONNECTED", pairingCode: null });
  });

  it("pedir um novo código (Gerar novo código) sempre traz outro, e não o anterior", async () => {
    const { provider, requests } = setup(["ABCD1234", "EFGH5678"]);
    await provider.connect({ phoneNumber: "5565988887777" });
    await settle();
    await provider.connect({ phoneNumber: "5565988887777" });
    await settle();
    expect(provider.getStatus().pairingCode).toBe("EFGH-5678");
    expect(requests).toHaveLength(2);
  });
});
