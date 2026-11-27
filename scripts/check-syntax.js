const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const srcDir = path.resolve(__dirname, "..", "src");
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".js"));

for (const f of files) {
  const full = path.join(srcDir, f);
  const res = spawnSync(process.execPath, ["--input-type=module", "--check"], {
    input: fs.readFileSync(full, "utf8"),
    encoding: "utf8",
  });
  if (res.status !== 0) {
    console.error(`Syntax error in ${f}:\n${res.stderr}`);
    process.exit(res.status || 1);
  }
}
console.log(`Syntax check passed for ${files.length} ES modules.`);
