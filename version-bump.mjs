import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.argv[2];
const manifestFile = "manifest.json";
const packageFile = "package.json";
const versionsFile = "versions.json";

// Read the current manifest
let manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
const currentVersion = manifest.version;

// Update manifest version
manifest.version = targetVersion;
writeFileSync(manifestFile, JSON.stringify(manifest, null, "\t"));

// Update package.json version
let packageJSON = JSON.parse(readFileSync(packageFile, "utf8"));
packageJSON.version = targetVersion;
writeFileSync(packageFile, JSON.stringify(packageJSON, null, "\t"));

// Update versions.json with the new version
let versions = {};
try {
    versions = JSON.parse(readFileSync(versionsFile, "utf8"));
} catch (e) {}

versions[targetVersion] = manifest.minAppVersion;
writeFileSync(versionsFile, JSON.stringify(versions, null, "\t")); 