import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { handleDownloadRequest } from "../functions/download/[plugin]/[version].js";

test("a browser downloads exact release bytes through the registry across origins", async ({
  page,
}) => {
  const archives = {
    "1.2.3": Buffer.from("current immutable archive"),
    "1.0.0": Buffer.from("historical immutable archive"),
  };
  const upstream = createServer((request, response) => {
    const version = request.url?.slice(1) as keyof typeof archives;
    response.writeHead(200, { "Content-Type": "application/octet-stream" });
    response.end(archives[version]);
  });
  const upstreamUrl = await listen(upstream);
  const targets = {
    targets: Object.fromEntries(
      Object.keys(archives).map((version) => [
        `test-plugin@${version}`,
        {
          pluginId: "test-plugin",
          version,
          status: "active",
          originUrl: `${upstreamUrl}/${version}`,
        },
      ]),
    ),
  };
  const delivery = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://localhost");
    const [, , plugin, version] = url.pathname.split("/");
    const result = await handleDownloadRequest(
      {
        request: new Request(url, { method: request.method }),
        params: { plugin, version },
        env: {},
      },
      targets,
    );
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  });
  const deliveryUrl = await listen(delivery);

  try {
    await page.goto("/");
    // The fixture origin reproduces GitHub's missing browser CORS headers.
    expect(
      await page.evaluate(async (url) => {
        try {
          await fetch(url);
          return false;
        } catch {
          return true;
        }
      }, `${upstreamUrl}/1.2.3`),
    ).toBe(true);

    for (const [version, archive] of Object.entries(archives)) {
      const result = await page.evaluate(async (url) => {
        const response = await fetch(url);
        const bytes = await response.arrayBuffer();
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        return {
          status: response.status,
          redirected: response.redirected,
          size: bytes.byteLength,
          sha256: [...new Uint8Array(hash)]
            .map((value) => value.toString(16).padStart(2, "0"))
            .join(""),
        };
      }, `${deliveryUrl}/download/test-plugin/${version}`);
      expect(result).toEqual({
        status: 200,
        redirected: false,
        size: archive.length,
        sha256: createHash("sha256").update(archive).digest("hex"),
      });
    }
  } finally {
    await Promise.all([close(upstream), close(delivery)]);
  }
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing test server address");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
