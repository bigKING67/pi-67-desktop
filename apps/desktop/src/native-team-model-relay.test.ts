import { Duplex } from "node:stream";
import { MessageChannel } from "node:worker_threads";
import { expect, it, vi } from "vitest";
import { createTeamModelPortChannel } from "../../agent-host/src/context/team-model-port-channel.js";
import { relayNativeTeamModelWorker } from "./native-team-model-relay.js";

it("relays simultaneous, fragmented large bytes through actual MessagePorts", async () => {
  const ports = new MessageChannel(), nativeWrites: Buffer[] = [], hostReads: Buffer[] = [];
  const native = new Duplex({ read() {}, write(bytes: Buffer, _encoding, done) { nativeWrites.push(Buffer.from(bytes)); done(); } });
  const host = createTeamModelPortChannel(ports.port2); host.on("data", (bytes: Buffer) => hostReads.push(Buffer.from(bytes)));
  const owner = new AbortController(), relay = relayNativeTeamModelWorker(native, ports.port1, owner.signal);
  const payload = Buffer.alloc(180_000, 42), response = Buffer.alloc(170_000, 24);
  try {
    native.push(payload.subarray(0, 60_000)); native.push(payload.subarray(60_000));
    await new Promise<void>((resolve, reject) => host.write(response, error => error ? reject(error) : resolve()));
    await vi.waitFor(() => expect(Buffer.concat(hostReads)).toEqual(payload));
    expect(Buffer.concat(nativeWrites)).toEqual(response);
    owner.abort(); await vi.waitFor(() => expect(host.destroyed).toBe(true)); expect(native.destroyed).toBe(true);
  } finally { relay.stop(); host.destroy(); }
});
it("pauses native reads until the Host consumes its buffered chunk", async () => {
  const ports = new MessageChannel(), received: Buffer[] = [];
  const native = new Duplex({ read() {}, write(_bytes, _encoding, done) { done(); } });
  const host = createTeamModelPortChannel(ports.port2);
  const relay = relayNativeTeamModelWorker(native, ports.port1, new AbortController().signal);
  const first = Buffer.alloc(90_000, 1), second = Buffer.alloc(90_000, 2);
  try {
    native.push(first); native.push(second);
    await vi.waitFor(() => expect(host.readableLength).toBe(first.length));
    expect(native.isPaused()).toBe(true); expect(native.readableLength).toBe(second.length);
    host.on("data", (bytes: Buffer) => received.push(Buffer.from(bytes)));
    await vi.waitFor(() => expect(Buffer.concat(received)).toEqual(Buffer.concat([first, second])));
  } finally { relay.stop(); host.destroy(); }
});
it("cancels backpressured writes when the Main owner retires", async () => {
  const ports = new MessageChannel(); let written = false;
  const native = new Duplex({ read() {}, write() { written = true; } });
  const host = createTeamModelPortChannel(ports.port2);
  const owner = new AbortController(), relay = relayNativeTeamModelWorker(native, ports.port1, owner.signal);
  const pending = new Promise<void>((resolve, reject) => host.write(Buffer.from("fixture"), error => error ? reject(error) : resolve()));
  const assertion = expect(pending).rejects.toThrow("unavailable");
  try {
    await vi.waitFor(() => expect(written).toBe(true)); owner.abort(); await assertion;
    expect(native.destroyed).toBe(true); expect(host.destroyed).toBe(true);
  } finally { relay.stop(); host.destroy(); }
});
it("retires both sides after a peer port closes", async () => {
  const ports = new MessageChannel();
  const native = new Duplex({ read() {}, write(_bytes, _encoding, done) { done(); } });
  const host = createTeamModelPortChannel(ports.port2);
  const relay = relayNativeTeamModelWorker(native, ports.port1, new AbortController().signal);
  try {
    ports.port2.close(); await vi.waitFor(() => expect(native.destroyed).toBe(true));
    await vi.waitFor(() => expect(host.destroyed).toBe(true));
  } finally { relay.stop(); host.destroy(); }
});
