import { createRequire } from 'node:module';

type PackageJson = {
  name?: unknown;
  version?: unknown;
};

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as PackageJson;

export const PACKAGE_NAME =
  typeof pkg.name === 'string' ? pkg.name : 'godot-mcp-omni';

export const PACKAGE_VERSION =
  typeof pkg.version === 'string' ? pkg.version : '0.0.0';
