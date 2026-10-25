import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { after, before, test } from "node:test";

let server: ChildProcess;
let baseUrl: string;

before(async () => {
  server = spawn(process.execPath, ["dist/server.js"], {
    env: { ...process.env, NODE_ENV: "production", GEMINI_API_KEY: "", PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  baseUrl = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server did not start")), 10_000);
    server.once("error", reject);
    server.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited before becoming ready: ${code}`));
    });
    let output = "";
    server.stdout!.on("data", (chunk) => {
      output += chunk.toString();
      const address = output.match(/http:\/\/0\.0\.0\.0:(\d+)/);
      if (address) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${address[1]}`);
      }
    });
  });
});

after(async () => {
  if (server?.exitCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
});

test("given a production build, when opened on a custom port, then serves the app and its assets", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Code Swipe/);
  const asset = html.match(/src="([^"]+\.js)"/);
  assert.ok(asset);
  const script = await fetch(`${baseUrl}${asset[1]}`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type") ?? "", /javascript/);
});

test("given no Gemini key, when an AI endpoint is called, then returns a configuration error without retrying", async () => {
  for (const endpoint of ["generate-cards", "ask-tutor"]) {
    const response = await fetch(`${baseUrl}/api/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.match(body.error, /GEMINI_API_KEY/);
    assert.equal(body.isRateLimit, false);
    assert.equal(body.isHighDemand, false);
    assert.equal(body.retryAfterSeconds, 0);
  }
});

test("given a production build, when server files are requested, then never exposes server code or source maps", async () => {
  for (const filename of ["server.js", "server.js.map", "server.cjs", "server.cjs.map"]) {
    const response = await fetch(`${baseUrl}/${filename}`);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await response.text(), /<!doctype html>/i);
  }
});
