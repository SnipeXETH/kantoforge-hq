import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import PublicSite from "./public/PublicSite";

// The public raffle site lives at /raffles* and needs no login; everything
// else is the authenticated admin app.
const path = window.location.pathname;
const isPublic = path === "/raffles" || path.startsWith("/raffles/");

createRoot(document.getElementById("root")).render(isPublic ? <PublicSite /> : <App />);
