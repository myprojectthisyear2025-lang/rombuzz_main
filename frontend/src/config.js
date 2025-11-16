// src/config.js
// Automatically choose correct backend based on environment
/*
const isLocal = window.location.hostname === "localhost";

export const API_BASE = isLocal
  ? "http://localhost:4000/api"
  : process.env.REACT_APP_API_BASE || "https://rombuzz-api-ulyk.onrender.com/api";

export const SOCKET_URL = isLocal
  ? "http://localhost:4000"
  : process.env.REACT_APP_SOCKET_URL || "https://rombuzz-api-ulyk.onrender.com";
*/


// src/config.js
// Automatically choose correct backend based on environment,
// with a hard-wired production URL for RomBuzz backend.

const hostname = window.location.hostname;
const isLocal =
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "0.0.0.0";

// Local dev (Vite + local Node server)
const LOCAL_API_BASE = "http://localhost:4000/api";
const LOCAL_SOCKET_URL = "http://localhost:4000";

// Production backend (Render)
const PROD_API_BASE = "https://rombuzz-api-ulyk.onrender.com/api";
const PROD_SOCKET_URL = "https://rombuzz-api-ulyk.onrender.com";

export const API_BASE = isLocal ? LOCAL_API_BASE : PROD_API_BASE;
export const SOCKET_URL = isLocal ? LOCAL_SOCKET_URL : PROD_SOCKET_URL;
