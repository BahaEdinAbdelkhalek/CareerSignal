"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function collectJavaScriptFiles(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...collectJavaScriptFiles(fullPath));
        else if (entry.isFile() && fullPath.endsWith(".js")) files.push(fullPath);
    }
    return files;
}

const targets = ["src", "test", "scripts"]
    .filter(directory => fs.existsSync(directory))
    .flatMap(collectJavaScriptFiles);

let failed = false;
for (const file of targets) {
    const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
    if (result.status !== 0) failed = true;
}
if (failed) process.exit(1);
console.log(`Syntax check passed for ${targets.length} JavaScript files.`);
