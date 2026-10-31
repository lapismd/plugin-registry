import { parse } from "jsonc-parser";

export class GitHubClient {
  constructor(token = process.env.GITHUB_TOKEN, fetchImpl = fetch) {
    this.token = token;
    this.fetch = fetchImpl;
  }
  async call(path, { method = "GET", body, missing = false } = {}) {
    const response = await this.fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (missing && response.status === 404) return null;
    if (!response.ok)
      throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  async list(path) {
    const values = [];
    for (let page = 1; ; page++) {
      const items = await this.call(
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      if (!Array.isArray(items))
        throw new Error("Expected paginated GitHub collection.");
      values.push(...items);
      if (items.length < 100) return values;
    }
  }
  async file(repo, path, ref, { missing = false } = {}) {
    const result = await this.call(
      `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
      { missing },
    );
    if (!result) return null;
    const errors = [];
    const value = parse(
      Buffer.from(result.content, "base64").toString("utf8"),
      errors,
      { allowTrailingComma: true },
    );
    if (errors.length) throw new Error(`Invalid JSON source: ${repo}/${path}`);
    return value;
  }
  async tagCommit(repo, tag) {
    const ref = await this.call(
      `/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`,
    );
    let object = ref.object;
    for (let depth = 0; depth < 8; depth++) {
      if (object.type === "commit") return object.sha;
      if (object.type !== "tag") break;
      object = (await this.call(`/repos/${repo}/git/tags/${object.sha}`))
        .object;
    }
    throw new Error("Release tag must resolve to a commit.");
  }
}
