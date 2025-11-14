// src/config.js
// Automatically choose correct backend based on environment

const isLocal = window.location.hostname === "localhost";

export const API_BASE = isLocal
  ? "http://localhost:4000/api"
  : process.env.REACT_APP_API_BASE || "https://rombuzz-api-ulyk.onrender.com/api";

export const SOCKET_URL = isLocal
  ? "http://localhost:4000"
  : process.env.REACT_APP_SOCKET_URL || "https://rombuzz-api-ulyk.onrender.com";
