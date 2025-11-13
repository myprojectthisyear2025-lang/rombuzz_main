//Rombuzz_main/Rombuzz/frontend/config-overrides.js

const webpack = require("webpack");
const path = require("path");

module.exports = function override(config) {
 // ============================
// 🔥 Disable all ESLint plugins
// ============================
if (config.plugins) {
  config.plugins = config.plugins.filter((plugin) => {
    const name = plugin.constructor && plugin.constructor.name;
    return name !== "ESLintWebpackPlugin" && name !== "ESLintPlugin";
  });
}


  // ============================
  // 🔧 Your existing fallbacks
  // ============================
  config.resolve.fallback = {
    ...config.resolve.fallback,
    process: require.resolve("process/browser.js"),
    stream: require.resolve("stream-browserify"),
    util: require.resolve("util"),
  };

  config.resolve.alias = {
    ...(config.resolve.alias || {}),
    "process/browser.js": path.resolve(__dirname, "node_modules/process/browser.js"),
  };

  // ============================
  // 🔧 Your existing plugins
  // ============================
  config.plugins = [
    ...(config.plugins || []),
    new webpack.ProvidePlugin({
      process: "process/browser.js",
    }),
  ];

  return config;
};
