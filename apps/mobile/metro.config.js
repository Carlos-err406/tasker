const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch packages/core and monorepo root node_modules
config.watchFolders = [
  path.resolve(monorepoRoot, 'packages', 'core'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Resolve modules from both local and monorepo root node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

config.resolver.unstable_enableSymlinks = true;

// Ensure all scoped packages from monorepo root are resolvable
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
