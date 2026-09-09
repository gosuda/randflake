import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "randflake-npm-"));
try {
  for (const workspace of ["sparx64", "randflake"]) {
    const [archive] = JSON.parse(
      execFileSync(
        "npm",
        ["pack", "--workspace", workspace, "--ignore-scripts", "--pack-destination", directory, "--json"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
      ),
    );
    const registryURL = `https://registry.npmjs.org/${encodeURIComponent(archive.name)}/${encodeURIComponent(archive.version)}`;
    const response = await fetch(registryURL);
    if (response.status === 404) {
      execFileSync("npm", ["publish", join(directory, archive.filename), "--ignore-scripts"], { stdio: "inherit" });
      continue;
    }
    if (!response.ok) {
      throw new Error(`Cannot inspect ${archive.name}@${archive.version}: registry HTTP ${response.status}`);
    }
    const published = await response.json();
    if (published.dist?.integrity !== archive.integrity) {
      throw new Error(`${archive.name}@${archive.version} is already published with different package contents`);
    }
    console.log(`${archive.name}@${archive.version} already contains this package; skipping upload`);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
